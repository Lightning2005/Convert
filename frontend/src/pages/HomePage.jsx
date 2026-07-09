import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { SUPPORTED_TOOLS } from '../config/tools';

export default function HomePage() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  // Состояния для загруженных файлов и валидации
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [detectedSource, setDetectedSource] = useState(null);
  const [targetFormat, setTargetFormat] = useState('');
  const [error, setError] = useState('');

  // Стейт для интерактивного FAQ аккордеона (хранит индекс открытого вопроса)
  const [openFaqIndex, setOpenFaqIndex] = useState(null);

  // Ограничения для безопасности сервера
  const MAX_TOTAL_SIZE_MB = 50;

  // Данные для блока FAQ
  const faqData = [
    {
      q: 'Безопасно ли загружать мои файлы на ваш сайт?',
      a: 'Абсолютно безопасно. Все загруженные файлы обрабатываются в изолированном облачном хранилище и автоматически удаляются с наших серверов ровно через 1 час после завершения конвертации. Мы не просматриваем, не копируем и не передаем ваши данные третьим лицам.'
    },
    {
      q: 'Как сконвертировать несколько картинок в один PDF-документ?',
      a: 'Очень просто! Перейдите в инструмент «Картинки в PDF» через верхнее меню, перетащите в зону загрузки сразу несколько файлов (до 10 штук за раз) и нажмите кнопку «Конвертировать». Сервис автоматически соберет их в один аккуратный многостраничный PDF-файл.'
    },
    {
      q: 'Портится ли качество изображений при конвертации?',
      a: 'Нет. Наш сервис использует современные алгоритмы обработки, которые сохраняют исходное разрешение, четкость и цветовую гамму ваших изображений. При конвертации в форматы без потери качества (например, из PNG в PDF) ваши файлы останутся в оригинальном виде.'
    },
    {
      q: 'Есть ли ограничения на размер или количество файлов?',
      a: 'На текущем этапе вы можете бесплатно загружать до 10 файлов в рамках одной сессии конвертации. Ограничение по размеру одного файла составляет 50 МБ, чего более чем достаточно для любых высококачественных фотографий и стандартных документов.'
    },
    {
      q: 'Нужно ли платить за использование сервиса?',
      a: 'Нет, наш конвертер полностью бесплатен. Вам не нужно оформлять подписку, регистрироваться или вводить данные карт. Все инструменты доступны в полном объеме без каких-либо скрытых платежей или водяных знаков на готовых документах.'
    }
  ];

  const getFileExtension = (filename) => {
    const ext = filename.split('.').pop().toLowerCase();
    if (ext === 'jpeg') return 'jpg';
    if (ext === 'tif') return 'tiff';
    return ext;
  };

  const getAvailableTargets = (sourceExt) => {
    return Object.values(SUPPORTED_TOOLS)
      .filter((tool) => tool.source === sourceExt)
      .map((tool) => ({ ext: tool.target, name: tool.targetName }));
  };

  const handleFilesReceived = (filesList) => {
    setError('');
    const filesArray = Array.from(filesList);
    if (filesArray.length === 0) return;

    const firstExt = getFileExtension(filesArray[0].name);
    const availableTargets = getAvailableTargets(firstExt);

    if (availableTargets.length === 0) {
      setError(`Формат .${firstExt} пока не поддерживается нашим конвертером.`);
      return;
    }

    const isSameType = filesArray.every((file) => getFileExtension(file.name) === firstExt);
    if (!isSameType) {
      setError('Для массовой конвертации выберите файлы одного формата (например, только JPG или только PDF).');
      return;
    }

    const sampleToolKey = Object.keys(SUPPORTED_TOOLS).find(
      (key) => SUPPORTED_TOOLS[key].source === firstExt
    );
    const maxFilesLimit = SUPPORTED_TOOLS[sampleToolKey]?.maxFiles || 10;

    if (filesArray.length > maxFilesLimit) {
      setError(`Превышен лимит! Для этого формата можно загрузить не более ${maxFilesLimit} файлов одновременно.`);
      return;
    }

    const totalSizeMb = filesArray.reduce((acc, file) => acc + file.size, 0) / (1024 * 1024);
    if (totalSizeMb > MAX_TOTAL_SIZE_MB) {
      setError(`Общий вес файлов превышает ${MAX_TOTAL_SIZE_MB} МБ. Пожалуйста, сожмите файлы или загружайте их частями.`);
      return;
    }

    setSelectedFiles(filesArray);
    setDetectedSource(firstExt);
    setTargetFormat(availableTargets[0].ext);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files) handleFilesReceived(e.dataTransfer.files);
  };

  const handleFileChange = (e) => {
    if (e.target.files) handleFilesReceived(e.target.files);
  };

  const handleProceed = () => {
    if (!detectedSource || !targetFormat || selectedFiles.length === 0) return;
    const toolSlug = `${detectedSource}-to-${targetFormat}`;
    navigate(`/tool/${toolSlug}`, {
      state: { preloadedFiles: selectedFiles }
    });
  };

  const handleCancel = () => {
    setSelectedFiles([]);
    setDetectedSource(null);
    setTargetFormat('');
    setError('');
  };

  const toggleFaq = (index) => {
    setOpenFaqIndex((prev) => (prev === index ? null : index));
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 text-left">
      {/* Hero-секция */}
      <div className="text-center mb-10">
        <h1 className="text-4xl font-extrabold text-text-primary tracking-tight sm:text-5xl mb-4">
          Умный конвертер файлов Конверт
        </h1>
        <p className="text-lg text-text-secondary max-w-2xl mx-auto">
          Быстрая и безопасная конвертация изображений и PDF документов онлайн. Без регистрации и водяных знаков.
        </p>
      </div>

      {/* Зона загрузки / Панель управления файлами */}
      <div className="bg-main rounded-2xl border border-ui-border p-8 mb-16">
        {selectedFiles.length === 0 ? (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-ui-border rounded-xl p-12 text-center cursor-pointer hover:border-text-secondary/40 transition-colors bg-surface-muted group"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              className="hidden"
            />
            <div className="mb-4 group-hover:scale-105 transition-transform text-text-secondary flex justify-center">
              <svg className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
              </svg>
            </div>
            <p className="text-xl font-medium text-text-primary mb-1">
              Перетащите файлы сюда или <span className="text-primary font-semibold">выберите на устройстве</span>
            </p>
            <p className="text-xs text-text-secondary mt-2">
              Макс. размер: {MAX_TOTAL_SIZE_MB} МБ суммарно. Поддерживаются PDF, JPG, PNG, WebP, TIFF, ICO, BMP, HEIC
            </p>
          </div>
        ) : (
          <div className="border border-ui-border rounded-xl p-6 bg-surface-muted">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div>
                <span className="inline-block bg-primary-light text-primary text-xs font-semibold px-2.5 py-0.5 rounded-md mb-2 border border-primary/10">
                  Успешно добавлено: {selectedFiles.length} файл(ов)
                </span>
                <h3 className="text-base font-medium text-text-primary truncate max-w-md">
                  {selectedFiles.length === 1 ? selectedFiles[0].name : `${selectedFiles[0].name} и ещё ${selectedFiles.length - 1}...`}
                </h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  Исходный формат: <span className="font-bold uppercase text-text-primary">{detectedSource}</span>
                </p>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-medium text-text-secondary whitespace-nowrap">Конвертировать в:</span>
                <select
                  value={targetFormat}
                  onChange={(e) => setTargetFormat(e.target.value)}
                  className="bg-main border border-ui-border hover:border-primary-light rounded-lg px-3 py-2 text-sm font-semibold text-text-primary shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
                >
                  {getAvailableTargets(detectedSource).map((target) => (
                    <option key={target.ext} value={target.ext}>
                      {target.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={handleCancel}
                  className="p-2 text-text-secondary hover:text-primary-hover active:text-primary-active rounded-lg hover:bg-main/50 transition-colors text-sm"
                  title="Отмена"
                >
                  ✕ Отмена
                </button>
                <button
                  onClick={handleProceed}
                  className="bg-primary hover:bg-primary-hover active:bg-primary-active text-white text-sm font-bold px-6 py-2.5 rounded-lg transition-colors flex items-center gap-2 shadow-sm"
                >
                  Далее
                </button>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 bg-error/10 border-l-4 border-error p-4 rounded-r-xl">
            <p className="text-sm text-error font-medium">{error}</p>
          </div>
        )}
      </div>

      {/* БЛОК СЕО 1: НАШИ ПРЕИМУЩЕСТВА */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        <div className="bg-main p-6 rounded-2xl border border-ui-border text-center flex flex-col items-center">
          <div className="mb-3 text-primary">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <h3 className="font-bold text-text-primary mb-2 text-sm md:text-base">Надежная защита</h3>
          <p className="text-xs text-text-secondary leading-relaxed">
            Файлы защищены сквозным шифрованием и полностью удаляются с серверов через 60 минут. Никаких утечек.
          </p>
        </div>
        <div className="bg-main p-6 rounded-2xl border border-ui-border text-center flex flex-col items-center">
          <div className="mb-3 text-primary">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
          </div>
          <h3 className="font-bold text-text-primary mb-2 text-sm md:text-base">Максимальное качество</h3>
          <p className="text-xs text-text-secondary leading-relaxed">
            Продвинутые библиотеки обработки сохраняют исходное разрешение, сочные цвета и четкость графики.
          </p>
        </div>
        <div className="bg-main p-6 rounded-2xl border border-ui-border text-center flex flex-col items-center">
          <div className="mb-3 text-primary">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h3 className="font-bold text-text-primary mb-2 text-sm md:text-base">Бесплатно</h3>
          <p className="text-xs text-text-secondary leading-relaxed">
            Конвертируйте документы без водяных знаков, скрытых платежей, подписок и обязательной регистрации.
          </p>
        </div>
      </div>

      {/* БЛОК СЕО 2: ИНТЕРАКТИВНЫЙ FAQ АККОРДЕОН */}
      <div className="border-t border-ui-border pt-10">
        <h2 className="text-2xl font-extrabold text-text-primary text-center mb-8">
          Часто задаваемые вопросы (FAQ)
        </h2>

        <div className="space-y-3">
          {faqData.map((item, index) => {
            const isOpen = openFaqIndex === index;
            return (
              <div
                key={index}
                className="bg-main border border-ui-border rounded-xl overflow-hidden"
              >
                <button
                  onClick={() => toggleFaq(index)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left font-semibold text-text-primary hover:bg-surface-muted transition-colors focus:outline-none"
                >
                  <span className="text-sm md:text-base">{item.q}</span>
                  <svg className={`w-3 h-3 text-text-secondary transition-transform duration-200 fill-current ${isOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                  </svg>
                </button>

                {/* Плавное раскрытие ответа */}
                <div
                  className={`transition-all duration-300 ease-in-out overflow-hidden ${
                    isOpen ? 'max-h-48 border-t border-ui-border bg-surface-muted/30' : 'max-h-0'
                  }`}
                >
                  <p className="p-5 text-sm text-text-secondary leading-relaxed">
                    {item.a}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}