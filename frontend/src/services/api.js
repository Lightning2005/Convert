import JSZip from 'jszip';

// По умолчанию API живёт на том же origin, что и страница: в разработке
// запросы на /api проксирует vite (см. vite.config.js), в продакшене фронт и
// бэкенд отдаются с одного домена. Отдельный адрес нужен только если API
// развёрнут на другом хосте.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 60; // ~90 секунд ожидания

async function postFormData(endpoint, formData) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Ошибка сервера: ${response.status}`);
  }

  return response.json();
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TERMINAL = new Set(['SUCCESS', 'FAILURE', 'UNKNOWN']);

/**
 * Пакетный опрос: батч из 50 файлов задаёт один запрос на цикл вместо пятидесяти.
 * Возвращает завершившие задачи и те, что не успели за отведённое время.
 */
async function pollTasks(taskIds, { intervalMs = POLL_INTERVAL_MS, maxAttempts = POLL_MAX_ATTEMPTS } = {}) {
  const pending = [...new Set(taskIds)];
  const finished = new Map();

  for (let attempt = 0; attempt < maxAttempts && pending.length > 0; attempt++) {
    const response = await fetch(`${API_BASE_URL}/api/status/batch/?ids=${encodeURIComponent(pending.join(','))}`);

    if (!response.ok) {
      throw new Error('Ошибка при проверке статуса задач на сервере.');
    }

    const { tasks } = await response.json();
    for (const task of tasks) {
      if (!TERMINAL.has(task.status)) continue;
      finished.set(task.task_id, task);
      pending.splice(pending.indexOf(task.task_id), 1);
    }

    if (pending.length > 0) await delay(intervalMs);
  }

  return { finished, timedOut: pending };
}

/** Готовый файл задачи. Бэкенд отдаёт путь без хоста — база на стороне фронтенда. */
async function downloadResult(task) {
  const fileResponse = await fetch(`${API_BASE_URL}${task.download_url}`);
  if (!fileResponse.ok) throw new Error('Не удалось скачать готовый файл.');
  return fileResponse.blob();
}

function taskError(task) {
  if (task.status === 'UNKNOWN') return 'Задача не найдена. Обновите страницу и попробуйте ещё раз.';
  return task.error || 'Ошибка при обработке файла в Celery.';
}

/** Один файл → одна задача → готовый Blob. */
async function submitAndAwait(submit) {
  const { task_id } = await submit();
  const { finished, timedOut } = await pollTasks([task_id]);
  const task = finished.get(task_id);

  if (!task) {
    throw new Error(timedOut.length
      ? 'Превышено время ожидания. Попробуйте позже или уменьшите количество файлов.'
      : 'Задача не вернула результат.');
  }
  if (task.status !== 'SUCCESS') throw new Error(taskError(task));

  return downloadResult(task);
}

export function swapExtension(filename, newExt) {
  const base = filename.replace(/\.[^/.]+$/, '');
  return `${base}.${newExt}`;
}

/** Не даёт файлам с одинаковыми именами затереть друг друга в архиве */
function uniqueName(used, name) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let index = 2;
  let candidate = `${base} (${index})${ext}`;
  while (used.has(candidate)) candidate = `${base} (${++index})${ext}`;
  used.add(candidate);
  return candidate;
}

export function downloadBlob(blob, filename) {
  const downloadUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.parentNode.removeChild(link);
  window.URL.revokeObjectURL(downloadUrl);
}

/** Несколько изображений → один PDF */
export async function convertImagesToPdf(files) {
  const formData = new FormData();
  files.forEach((file) => formData.append('images', file));

  const blob = await submitAndAwait(() => postFormData('/api/images-to-pdf/', formData));

  const filename = files.length === 1
    ? swapExtension(files[0].name, 'pdf')
    : 'converted_images.pdf';

  return { blob, filename };
}

function pdfFormData(pdfFile, target) {
  const formData = new FormData();
  formData.append('pdf', pdfFile);
  formData.append('target', target);
  return formData;
}

/** PDF → ZIP с изображениями */
export async function convertPdfToImages(pdfFile, target = 'jpg') {
  const blob = await submitAndAwait(() => postFormData('/api/pdf-to-images/', pdfFormData(pdfFile, target)));

  const baseName = pdfFile.name.replace(/\.pdf$/i, '');
  const filename = `${baseName}_pages.zip`;

  return { blob, filename };
}

function imageFormData(file, target) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('target', target);
  return formData;
}

const imageTargetExt = (target) => (target === 'jpeg' ? 'jpg' : target);

/** Одно изображение → другой формат */
export async function convertImage(file, target) {
  const blob = await submitAndAwait(() => postFormData('/api/convert/', imageFormData(file, target)));

  return { blob, filename: swapExtension(file.name, imageTargetExt(target)) };
}

/**
 * Общий путь батча: сначала отправляем все файлы, дальше следим за всеми
 * задачами одним пакетным запросом за цикл и скачиваем успевшие.
 */
async function runBatch(files, { endpoint, makeForm, makeName, unit, emptyError, merge }) {
  const posted = await Promise.allSettled(files.map(async (file) => {
    const { task_id } = await postFormData(endpoint, makeForm(file));
    return { file, task_id };
  }));
  const jobs = posted.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const { finished, timedOut } = await pollTasks(jobs.map((job) => job.task_id));

  const results = await Promise.allSettled(jobs.map(async (job) => {
    const task = finished.get(job.task_id);
    if (!task) throw new Error('Задача не вернула результат.');
    if (task.status !== 'SUCCESS') throw new Error(taskError(task));
    return { blob: await downloadResult(task), filename: makeName(job.file) };
  }));
  const done = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);

  const failedCount = files.length - done.length;
  let notice = failedCount > 0
    ? `Готово не всё: ${failedCount} из ${files.length} ${unit} обработать не удалось.`
    : '';
  if (timedOut.length > 0) {
    notice += ` Часть задач не завершилась за ${Math.round(POLL_INTERVAL_MS * POLL_MAX_ATTEMPTS / 1000)} секунд.`;
  }

  if (done.length === 0) {
    throw new Error(emptyError);
  }
  if (done.length === 1) {
    return { ...done[0], notice };
  }

  return { ...(await merge(done)), notice };
}

/** Параллельная обработка нескольких изображений с частичным результатом */
export async function convertImages(files, target) {
  if (files.length === 1) {
    return convertImage(files[0], target);
  }
  const ext = imageTargetExt(target);

  return runBatch(files, {
    endpoint: '/api/convert/',
    makeForm: (file) => imageFormData(file, target),
    makeName: (file) => swapExtension(file.name, ext),
    unit: 'файлов',
    emptyError: 'Ни один файл не удалось конвертировать. Проверьте, что они не повреждены.',
    merge: async (done) => {
      const zip = new JSZip();
      const used = new Set();
      done.forEach(({ blob, filename }) => {
        zip.file(uniqueName(used, filename), blob);
      });

      return {
        blob: await zip.generateAsync({ type: 'blob' }),
        filename: `converted_${ext}_files.zip`,
      };
    },
  });
}

/** Несколько PDF: каждый нарезается, страницы раскладываются по папкам документов */
export async function convertPdfFilesToImages(files, target = 'jpg') {
  if (files.length === 1) {
    return convertPdfToImages(files[0], target);
  }

  return runBatch(files, {
    endpoint: '/api/pdf-to-images/',
    makeForm: (file) => pdfFormData(file, target),
    makeName: (file) => `${file.name.replace(/\.pdf$/i, '')}_pages.zip`,
    unit: 'документов',
    emptyError: 'Ни один PDF не удалось обработать. Проверьте, что файлы не повреждены.',
    merge: async (done) => {
      const zip = new JSZip();
      for (const { blob, filename } of done) {
        const inner = await JSZip.loadAsync(blob);
        const folder = filename.replace(/\.zip$/i, '') || 'document';
        for (const entry of Object.values(inner.files)) {
          if (entry.dir) continue;
          zip.file(`${folder}/${entry.name}`, await entry.async('blob'));
        }
      }

      return {
        blob: await zip.generateAsync({ type: 'blob' }),
        filename: 'converted_pdf_pages.zip',
      };
    },
  });
}

export async function runConversion(config, files) {
  if (config.target === 'pdf') {
    return convertImagesToPdf(files);
  }
  if (config.source === 'pdf') {
    if (files.length === 1) {
      return convertPdfToImages(files[0], config.target);
    }
    return convertPdfFilesToImages(files, config.target);
  }
  if (config.category === 'image') {
    return convertImages(files, config.target);
  }
  throw new Error('Данное направление конвертации временно не поддерживается сервером.');
}