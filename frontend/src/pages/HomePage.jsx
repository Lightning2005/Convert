import { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SUPPORTED_TOOLS, MAX_FILE_SIZE_MB } from '../config/tools';
import { HOME_FAQ } from '../config/faq';

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

  // Лимиты количества файлов и ответы FAQ живут в config/faq.js: из того же
  // источника читает их и JSON-LD, поэтому цифры в тексте страницы и в
  // разметке для поисковика не могут разойтись.

  // Сетка инструментов собрана из Link, а не из navigate(): prerender отдаёт
  // статистику без JavaScript, и если ссылок нет в HTML, поисковый робот видит
  // главную, где из документов только политика и контакты, а инструменты
  // остаются недостижимы кроме как из sitemap.xml.
  const toolsByCategory = Object.entries(SUPPORTED_TOOLS).map(([slug, tool]) => ({ slug, ...tool }));
  const toolCount = toolsByCategory.length;
  const toolGroups = [
    { key: 'pdf', title: 'Инструменты PDF', tools: toolsByCategory.filter((tool) => tool.category === 'pdf') },
    { key: 'image', title: 'Конвертер картинок', tools: toolsByCategory.filter((tool) => tool.category === 'image') },
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
      setError(`Формат .${firstExt} не поддерживается. Список доступных форматов — в разделе «Все инструменты».`);
      return;
    }

    const isSameType = filesArray.every((file) => getFileExtension(file.name) === firstExt);
    if (!isSameType) {
      setError('Выберите файлы одного формата — например, только JPG или только PDF.');
      return;
    }

    // Цель на главной ещё не выбрана, поэтому ограничиваемся самым щедрым
    // лимитом среди доступных форматов: страница инструмента урежет его до своего
    const maxFilesLimit = Math.max(
      ...Object.values(SUPPORTED_TOOLS)
        .filter((tool) => tool.source === firstExt)
        .map((tool) => tool.maxFiles)
    );

    if (filesArray.length > maxFilesLimit) {
      setError(`За один раз можно загрузить не более ${maxFilesLimit} файлов.`);
      return;
    }

    // Цель ещё не выбрана, поэтому здесь проверяем то, что верно для любого
    // инструмента: файл тяжелее лимита не примет ни один эндпоинт. Суммарный
    // вес считаем на кнопке перехода — там уже известен целевой формат.
    const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
    const tooHeavy = filesArray.filter((file) => file.size > maxBytes);
    if (tooHeavy.length > 0) {
      setError(`Файлов тяжелее ${MAX_FILE_SIZE_MB} МБ: ${tooHeavy.length}. Уберите их или загрузите по частям.`);
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
    e.target.value = '';
  };

  const handleProceed = () => {
    if (!detectedSource || !targetFormat || selectedFiles.length === 0) return;
    if (targetFormat === 'pdf') {
      const totalBytes = selectedFiles.reduce((acc, file) => acc + file.size, 0);
      if (totalBytes > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setError(`Для PDF файлы отправляются одним запросом, поэтому суммарный вес не должен превышать ${MAX_FILE_SIZE_MB} МБ. Уберите часть файлов.`);
        return;
      }
    }
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
    <div className="w-full max-w-4xl mx-auto px-4 py-6 text-left">
      {/* Hero-секция */}
      <div className="text-center mb-6 sm:mb-10">
        <h1 className="text-3xl font-extrabold text-text-primary tracking-tight sm:text-5xl mb-3 sm:mb-4">
          Конвертер изображений и PDF онлайн
        </h1>
        <p className="text-base sm:text-lg text-text-secondary max-w-2xl mx-auto">
          Бесплатно, без регистрации и водяных знаков. Исходники удаляются сразу после обработки, результаты — в течение часа.
        </p>
      </div>

      {/* Зона загрузки / Панель управления файлами */}
      <div className="bg-main rounded-2xl border border-ui-border px-4 py-6 sm:p-8 mb-10 sm:mb-16">
        {selectedFiles.length === 0 ? (
          <div
            role="button"
            tabIndex={0}
            aria-label="Добавить файлы для конвертации"
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-ui-border rounded-xl p-6 sm:p-12 text-center cursor-pointer hover:border-text-secondary/40 transition-colors bg-surface-muted group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              className="hidden"
            />
            <div className="mb-3 sm:mb-4 group-hover:scale-105 transition-transform text-text-secondary flex justify-center">
              <svg className="h-10 w-10 sm:h-12 sm:w-12" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
              </svg>
            </div>
            <p className="text-lg sm:text-xl font-medium text-text-primary mb-1">
              Перетащите файлы сюда или <span className="text-primary font-semibold">выберите на устройстве</span>
            </p>
            <p className="text-xs text-text-secondary mt-2">
              До {MAX_FILE_SIZE_MB} МБ на файл; при сборке PDF лимит считается по сумме. Форматы: PDF, JPG, PNG, WebP, TIFF, BMP, HEIC, ICO.
            </p>
          </div>
        ) : (
          <div className="border border-ui-border rounded-xl p-4 sm:p-6 bg-surface-muted">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="min-w-0 lg:flex-1 lg:basis-0">
                <span className="inline-block bg-primary-light text-primary text-xs font-semibold px-2.5 py-0.5 rounded-md mb-2 border border-primary/10">
                  Добавлено файлов: {selectedFiles.length}
                </span>
                <h3 className="text-base font-medium text-text-primary truncate">
                  {selectedFiles.length === 1 ? selectedFiles[0].name : `${selectedFiles[0].name} и ещё ${selectedFiles.length - 1}...`}
                </h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  Исходный формат: <span className="font-bold uppercase text-text-primary">{detectedSource}</span>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 sm:gap-3 lg:shrink-0">
                <span className="text-sm font-medium text-text-secondary whitespace-nowrap">Конвертировать в:</span>
                <div className="relative">
                  <select
                    value={targetFormat}
                    onChange={(e) => setTargetFormat(e.target.value)}
                    className="appearance-none bg-main border border-ui-border hover:border-primary-light rounded-lg px-3 pr-9 py-2 text-sm font-semibold text-text-primary shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
                  >
                    {getAvailableTargets(detectedSource).map((target) => (
                      <option key={target.ext} value={target.ext}>
                        {target.name}
                      </option>
                    ))}
                  </select>
                  <svg
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-secondary"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              <div className="flex items-center gap-2 justify-end lg:shrink-0">
                <button
                  onClick={handleCancel}
                  className="p-2 text-text-secondary hover:text-error active:text-error rounded-lg hover:bg-main/50 transition-colors text-sm"
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
          <h3 className="font-bold text-text-primary mb-2 text-sm md:text-base">Приватность</h3>
          <p className="text-xs text-text-secondary leading-relaxed">
            Соединение по HTTPS. Исходник удаляется сразу после конвертации, готовый файл — в течение часа, отдельной задачей очистки.
          </p>
        </div>
        <div className="bg-main p-6 rounded-2xl border border-ui-border text-center flex flex-col items-center">
          <div className="mb-3 text-primary">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
          </div>
          <h3 className="font-bold text-text-primary mb-2 text-sm md:text-base">Качество</h3>
          <p className="text-xs text-text-secondary leading-relaxed">
            PNG, TIFF, BMP и ICO сохраняют пиксели без потерь. JPEG и WebP сжимают с потерями — это свойство самих форматов, а не конвертера.
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
            Все {toolCount} инструмента доступны без подписки, регистрации и данных карты. Водяных знаков на результатах нет.
          </p>
        </div>
      </div>

      {/* БЛОК СЕО 1: СЕТКА ИНСТРУМЕНТОВ — единственные постоянные внутренние
          ссылки на страницы конвертеров */}
      <section id="tools" className="border-t border-ui-border pt-10 mb-16">
        <h2 className="text-2xl font-extrabold text-text-primary text-center mb-2">
          Все инструменты
        </h2>
        <p className="text-sm text-text-secondary text-center mb-8 max-w-2xl mx-auto">
          {toolCount} конвертера по форматам: у каждого своя страница с описанием, лимитами и ответами на вопросы.
        </p>
        <div className="space-y-8">
          {toolGroups.map((group) => (
            <div key={group.key}>
              <h3 className="font-bold text-text-primary text-sm md:text-base mb-3">{group.title}</h3>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {group.tools.map((tool) => (
                  <li key={tool.slug}>
                    <Link
                      to={`/tool/${tool.slug}`}
                      className="flex min-h-11 items-center gap-2 rounded-xl border border-ui-border bg-main px-3 py-2 text-sm text-text-primary hover:border-primary hover:bg-primary-light transition-colors"
                    >
                      <span aria-hidden="true">{tool.icon}</span>
                      <span className="truncate">{tool.sourceName} в {tool.targetName}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* БЛОК СЕО 2: ИНТЕРАКТИВНЫЙ FAQ АККОРДЕОН */}
      <div className="border-t border-ui-border pt-10">
        <h2 className="text-2xl font-extrabold text-text-primary text-center mb-8">
          Частые вопросы
        </h2>

        <div className="space-y-3">
          {HOME_FAQ.map((item, index) => {
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

                {/* Плавное раскрытие ответа: высота берётся из содержимого,
                    поэтому длинный текст не обрезается на узких экранах */}
                <div
                  className={`grid transition-all duration-300 ease-in-out ${
                    isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className={`overflow-hidden ${isOpen ? 'border-t border-ui-border bg-surface-muted/30' : ''}`}>
                    <p className="p-5 text-sm text-text-secondary leading-relaxed">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}