import JSZip from 'jszip';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

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

/**
 * Функция опроса статуса задачи (Polling)
 */
async function pollTaskStatus(taskId) {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  while (true) {
    // ВНИМАНИЕ: Проверь путь '/api/tasks/' в своем urls.py бэкенда!
    const response = await fetch(`${API_BASE_URL}/api/status/${taskId}/`);

    if (!response.ok) {
      throw new Error('Ошибка при проверке статуса задачи на сервере.');
    }

    const data = await response.json();

    if (data.status === 'SUCCESS') {
      // Задача завершена, скачиваем реальный бинарный файл по ссылке от бэкенда
      const fileResponse = await fetch(data.download_url);
      if (!fileResponse.ok) throw new Error('Не удалось скачать готовый файл.');
      return await fileResponse.blob();
    }

    if (data.status === 'FAILURE') {
      throw new Error(data.error || 'Ошибка при обработке файла в Celery.');
    }

    // Если статус PENDING или STARTED — ждем 1.5 секунды и повторяем запрос
    await delay(1500);
  }
}

export function swapExtension(filename, newExt) {
  const base = filename.replace(/\.[^/.]+$/, '');
  return `${base}.${newExt}`;
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

/** Параллельная обработка нескольких изображений */
export async function convertImages(files, target) {
  if (files.length === 1) {
    return convertImage(files[0], target);
  }

  const conversionPromises = files.map((file) => convertImage(file, target));
  const results = await Promise.all(conversionPromises);

  const zip = new JSZip();
  results.forEach(({ blob, filename }) => {
    zip.file(filename, blob);
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  const ext = target === 'jpeg' ? 'jpg' : target;
  const filename = `converted_${ext}_files.zip`;

  return { blob, filename };
}

export async function runConversion(config, files) {
  if (config.target === 'pdf') {
    return convertImagesToPdf(files);
  }
  if (config.source === 'pdf') {
    return convertPdfToImages(files[0], config.target);
  }
  if (config.category === 'image') {
    return convertImages(files, config.target);
  }
  throw new Error('Данное направление конвертации временно не поддерживается сервером.');
}