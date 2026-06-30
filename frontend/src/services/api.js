import JSZip from 'jszip';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

async function postFormData(endpoint, formData) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Ошибка сервера: ${response.status}`);
  }

  return response.blob();
}

/** Заменяет расширение файла, сохраняя исходное имя */
export function swapExtension(filename, newExt) {
  const base = filename.replace(/\.[^/.]+$/, '');
  return `${base}.${newExt}`;
}

/** Скачивает blob через временную ссылку в браузере */
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

  const blob = await postFormData('/api/images-to-pdf/', formData);
  const filename = files.length === 1
    ? swapExtension(files[0].name, 'pdf')
    : 'converted_images.pdf';

  return { blob, filename };
}

/** PDF → ZIP с изображениями (JPG или PNG) */
export async function convertPdfToImages(pdfFile, target = 'jpg') {
  const formData = new FormData();
  formData.append('pdf', pdfFile);
  formData.append('target', target);

  const blob = await postFormData('/api/pdf-to-images/', formData);
  const baseName = pdfFile.name.replace(/\.pdf$/i, '');
  const filename = `${baseName}_pages.zip`;

  return { blob, filename };
}

/** Одно изображение → другой формат через /api/convert/ */
export async function convertImage(file, target) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('target', target);

  const blob = await postFormData('/api/convert/', formData);
  const ext = target === 'jpeg' ? 'jpg' : target;
  const filename = swapExtension(file.name, ext);

  return { blob, filename };
}

/** Одно или несколько изображений: один файл — напрямую, несколько — ZIP (Параллельная обработка) */
export async function convertImages(files, target) {
  if (files.length === 1) {
    return convertImage(files[0], target);
  }

  // 1. Создаем массив промисов и запускаем их параллельно
  const conversionPromises = files.map((file) => convertImage(file, target));

  // 2. Ждем завершения всех запросов
  const results = await Promise.all(conversionPromises);

  const zip = new JSZip();

  // 3. Синхронно добавляем полученные данные в ZIP-архив
  results.forEach(({ blob, filename }) => {
    zip.file(filename, blob);
  });

  const blob = await zip.generateAsync({ type: 'blob' });
  const ext = target === 'jpeg' ? 'jpg' : target;
  const filename = `converted_${ext}_files.zip`;

  return { blob, filename };
}

/** Единая точка входа для ConverterForm на основе config инструмента */
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