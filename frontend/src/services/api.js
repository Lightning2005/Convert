import JSZip from 'jszip';

// По умолчанию API живёт на том же origin, что и страница: в разработке
// запросы на /api проксирует vite (см. vite.config.js), в продакшене фронт и
// бэкенд отдаются с одного домена. Отдельный адрес нужен только если API
// развёрнут на другом хосте.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 60; // ~90 секунд ожидания

/**
 * Изменено: теперь функция возвращает JSON с task_id, а не Blob файла
 */
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

/** Опрос статуса Celery-задачи с ограничением по времени */
async function pollTaskStatus(taskId, maxAttempts = POLL_MAX_ATTEMPTS) {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`${API_BASE_URL}/api/status/${taskId}/`);

    if (!response.ok) {
      throw new Error('Ошибка при проверке статуса задачи на сервере.');
    }

    const data = await response.json();

    if (data.status === 'SUCCESS') {
      // Бэкенд отдаёт путь без хоста — база подставляется на стороне фронтенда.
      const fileResponse = await fetch(`${API_BASE_URL}${data.download_url}`);
      if (!fileResponse.ok) throw new Error('Не удалось скачать готовый файл.');
      return await fileResponse.blob();
    }

    if (data.status === 'FAILURE') {
      throw new Error(data.error || 'Ошибка при обработке файла в Celery.');
    }

    await delay(POLL_INTERVAL_MS);
  }

  throw new Error('Превышено время ожидания. Попробуйте позже или уменьшите количество файлов.');
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

  // 1. Получаем task_id от бэкенда
  const { task_id } = await postFormData('/api/images-to-pdf/', formData);

  // 2. Ждем, пока Celery сделает работу, и получаем настоящий Blob
  const blob = await pollTaskStatus(task_id);

  const filename = files.length === 1
    ? swapExtension(files[0].name, 'pdf')
    : 'converted_images.pdf';

  return { blob, filename };
}

/** PDF → ZIP с изображениями */
export async function convertPdfToImages(pdfFile, target = 'jpg') {
  const formData = new FormData();
  formData.append('pdf', pdfFile);
  formData.append('target', target);

  const { task_id } = await postFormData('/api/pdf-to-images/', formData);
  const blob = await pollTaskStatus(task_id);

  const baseName = pdfFile.name.replace(/\.pdf$/i, '');
  const filename = `${baseName}_pages.zip`;

  return { blob, filename };
}

/** Одно изображение → другой формат */
export async function convertImage(file, target) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('target', target);

  const { task_id } = await postFormData('/api/convert/', formData);
  const blob = await pollTaskStatus(task_id);

  const ext = target === 'jpeg' ? 'jpg' : target;
  const filename = swapExtension(file.name, ext);

  return { blob, filename };
}

/** Параллельная обработка нескольких изображений с частичным результатом */
export async function convertImages(files, target) {
  if (files.length === 1) {
    return convertImage(files[0], target);
  }

  const settled = await Promise.allSettled(files.map((file) => convertImage(file, target)));
  const done = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failedCount = files.length - done.length;
  const notice = failedCount > 0
    ? `Готово не всё: ${failedCount} из ${files.length} файлов обработать не удалось.`
    : '';

  if (done.length === 0) {
    throw new Error('Ни один файл не удалось конвертировать. Проверьте, что они не повреждены.');
  }

  if (done.length === 1) {
    return { ...done[0], notice };
  }

  const zip = new JSZip();
  const used = new Set();
  done.forEach(({ blob, filename }) => {
    zip.file(uniqueName(used, filename), blob);
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  const ext = target === 'jpeg' ? 'jpg' : target;
  const filename = `converted_${ext}_files.zip`;

  return { blob, filename, notice };
}

/** Несколько PDF: каждый нарезается, страницы раскладываются по папкам документов */
export async function convertPdfFilesToImages(files, target = 'jpg') {
  const settled = await Promise.allSettled(files.map((file) => convertPdfToImages(file, target)));
  const done = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const failedCount = files.length - done.length;
  const notice = failedCount > 0
    ? `Готово не всё: ${failedCount} из ${files.length} документов обработать не удалось.`
    : '';

  if (done.length === 0) {
    throw new Error('Ни один PDF не удалось обработать. Проверьте, что файлы не повреждены.');
  }

  if (done.length === 1) {
    return { ...done[0], notice };
  }

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
    notice,
  };
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