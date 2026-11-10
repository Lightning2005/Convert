import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { runConversion, downloadBlob } from '../services/api';
import { SUPPORTED_TOOLS, MAX_FILE_SIZE_MB } from '../config/tools';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';

// Импорты dnd-kit
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay // <-- Добавили оверлей
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Сообщения Celery содержат пути и стеки — в интерфейсе показываем только человеческий текст
function humanizeError(raw) {
  const message = String(raw || '').trim();
  if (/celery|cannot identify|truncated|unrecognized|corrupt|stack trace|exception/i.test(message)) {
    return 'Файл повреждён или записан не полностью. Попробуйте пересохранить его и повторить.';
  }
  if (/poppler|unable to get page count|encrypted|password/i.test(message)) {
    return 'Не удаётся прочитать PDF: файл повреждён или защищён паролем.';
  }
  if (/timeout|timed out|failed to fetch|networkerror/i.test(message)) {
    return 'Сервер не отвечает. Проверьте соединение и попробуйте ещё раз.';
  }
  if (/[а-яА-ЯёЁ]/.test(message)) return message;
  return 'Сервер не смог обработать файл. Проверьте файл и попробуйте ещё раз.';
}

// 1. Чистый презентационный компонент строки (используется и в списке, и в оверлее)
function FileItemView({
  item,
  index,
  onRemove,
  isLoading,
  isSortableEnabled,
  attributes,
  listeners,
  isDragging,
  isOverlay
}) {
  const [thumbUrl, setThumbUrl] = useState('');

  useEffect(() => {
    if (!item.file) return;

    if (item.file.type.startsWith('image/')) {
      const url = URL.createObjectURL(item.file);
      // Объектный URL живёт вне React, и создать его нужно вместе с превью:
      // в render это было бы нечистое побочное действие, которое потеряется
      // при прерванном рендере.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setThumbUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [item.file]);

  return (
    <div
      className={`flex items-center justify-between p-2.5 bg-main border border-ui-border rounded-xl shadow-xs ${
        isOverlay
          ? 'border-primary ring-2 ring-primary/10 shadow-md bg-surface-muted scale-[1.01] opacity-95' // Стили для летящего клона
          : isDragging
          ? 'opacity-30 border-dashed border-ui-border bg-surface-muted/50' // Стили для слота-placeholder в списке
          : 'hover:border-text-secondary/40 transition-all'
      } ${isLoading ? 'opacity-50 pointer-events-none' : ''}`}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {isSortableEnabled && !isLoading && (
          <div
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing min-h-11 min-w-11 flex items-center justify-center p-1 text-text-secondary hover:text-text-primary rounded-md hover:bg-surface-muted transition-colors shrink-0"
            title="Перетащите для изменения порядка страниц"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M9 5a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm6-12a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
            </svg>
          </div>
        )}

        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={item.file.name}
            className="w-10 h-10 object-cover rounded-lg border border-ui-border shrink-0 select-none bg-surface-muted"
          />
        ) : (
          <div className="w-10 h-10 flex items-center justify-center bg-surface-muted border border-ui-border rounded-lg shrink-0 text-text-secondary">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
        )}

        <span className="text-sm font-medium text-text-primary truncate">{item.file.name}</span>
      </div>

      {!isLoading && !isOverlay && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(index);
          }}
          className="ml-2 min-h-11 min-w-11 p-1.5 text-text-secondary hover:text-error rounded-lg hover:bg-surface-muted transition-colors flex items-center justify-center shrink-0"
          title="Удалить файл"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// 2. Компонент-обертка для dnd-kit
function SortableFileItem({ id, item, index, onRemove, isLoading, isSortableEnabled }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id, disabled: !isSortableEnabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: isDragging ? undefined : transition,
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <FileItemView
        item={item}
        index={index}
        onRemove={onRemove}
        isLoading={isLoading}
        isSortableEnabled={isSortableEnabled}
        attributes={attributes}
        listeners={listeners}
        isDragging={isDragging}
      />
    </div>
  );
}

export default function ConverterForm({ slug, config, preloadedFiles }) {
  // Форма пересоздаётся под каждый инструмент (key={slug} в ConverterPage), а файлы
  // приходят вместе с переходом с главной, поэтому список собирается один раз при
  // инициализации состояния — эффекта-синхронизатора здесь быть не должно.
  const [files, setFiles] = useState(() => (preloadedFiles ?? []).slice(0, config.maxFiles).map((file, idx) => ({
    id: `preload-${idx}-${file.name}-${file.size}`,
    file
  })));
  const [activeId, setActiveId] = useState(null); // <-- Храним ID файла, который сейчас тащат
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState(() => (files.length < (preloadedFiles?.length ?? 0)
    ? `Этот инструмент принимает не более ${config.maxFiles} файлов, поэтому взяты первые ${files.length}.`
    : ''));
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef(null);

  const isSortableEnabled = config.targetName?.toUpperCase() === 'PDF';

  // config.steps — три шага инструмента: загрузка, обработка, результат. Строка
  // про порядок файлов вставляется в середину только там, где список действительно
  // перетаскивается (isSortableEnabled), поэтому в тексте шагов её нет.
  const steps = config.steps
    ? [
        config.steps[0],
        ...(isSortableEnabled ? ['Настройте нужный порядок файлов с помощью перетаскивания строк'] : []),
        ...config.steps.slice(1),
      ]
    : [
        'Перетащите файлы в зону выше или нажмите для выбора',
        ...(isSortableEnabled ? ['Настройте нужный порядок файлов с помощью перетаскивания строк'] : []),
        'Нажмите кнопку «Конвертировать»',
        `Дождитесь завершения обработки и скачайте готовый ${config.targetName}`,
      ];

  // Смежные инструменты: сначала те, что берут тот же исходник, потом те, что
  // дают ту же цель. Страница инструмента не должна быть тупиком, из которого
  // можно уйти только в шапку, — и для робота это второй вход в документ.
  const sameSource = [];
  const sameTarget = [];
  for (const [otherSlug, tool] of Object.entries(SUPPORTED_TOOLS)) {
    if (otherSlug === slug) continue;
    if (tool.source === config.source) sameSource.push([otherSlug, tool]);
    else if (tool.target === config.target) sameTarget.push([otherSlug, tool]);
  }
  const relatedTools = [...sameSource, ...sameTarget].slice(0, 8);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  useEffect(() => {
    const handleWindowDragOver = (e) => e.preventDefault();
    const handleWindowDrop = (e) => e.preventDefault();

    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDrop);

    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, []);

  // Уход с экрана (смена инструмента, другой роут) обрывает отправку, опрос
  // статуса и скачивание: иначе задача продолжает грузить браузер результатом,
  // который уже некому показать.
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files));
    }
    e.target.value = '';
  };

  const onButtonClick = () => {
    fileInputRef.current.click();
  };

  const handleFiles = (newFiles) => {
    setError('');
    setNotice('');
    const allowedExts = config.accept.toLowerCase().split(',').map((s) => s.trim());

    const filtered = newFiles.filter((file) => {
      const ext = `.${file.name.split('.').pop().toLowerCase()}`;
      return allowedExts.includes(ext);
    });

    const rejected = newFiles.length - filtered.length;

    if (filtered.length === 0) {
      setError(`Пожалуйста, выберите файлы в формате ${config.sourceName}`);
      return;
    }

    // Оба факта могут появиться в одной пачке: второй setError затирал первый,
    // и пользователь не узнавал, что часть файлов отброшена по формату.
    const problems = [];

    if (rejected > 0) {
      problems.push(`Отброшено файлов: ${rejected}. Поддерживается только ${config.sourceName}.`);
    }

    // Бэкенд отвечает 400 на файл тяжелее 50 МБ, а сборку PDF лимитирует по
    // сумме всех файлов: они уходят одним запросом. Узнавать об этом при
    // отправке поздно — список уже собран, а запросы уже ушли.
    const maxBytes = MAX_FILE_SIZE_MB * 1024 * 1024;
    const perFile = filtered.filter((file) => file.size <= maxBytes);

    if (filtered.length - perFile.length > 0) {
      problems.push(`Отброшено файлов: ${filtered.length - perFile.length} тяжелее ${MAX_FILE_SIZE_MB} МБ.`);
    }

    let kept = perFile;
    if (config.target === 'pdf') {
      let budget = maxBytes - files.reduce((acc, item) => acc + item.file.size, 0);
      kept = perFile.filter((file) => {
        if (file.size > budget) return false;
        budget -= file.size;
        return true;
      });
      if (kept.length < perFile.length) {
        problems.push(`PDF собирается одним запросом, поэтому суммарный вес файлов не больше ${MAX_FILE_SIZE_MB} МБ: добавлено ${kept.length} из ${perFile.length}.`);
      }
    }

    if (perFile.length === 0) {
      setError(problems.join(' '));
      return;
    }

    const withIds = kept.map((file, idx) => ({
      id: `${file.name}-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
      file
    }));

    const room = config.maxFiles - files.length;
    const accepted = withIds.slice(0, Math.max(room, 0));

    if (accepted.length < withIds.length) {
      problems.push(`Вмещается не более ${config.maxFiles} файлов, поэтому добавлено ${accepted.length} из ${withIds.length}.`);
    }

    if (problems.length > 0) {
      setError(problems.join(' '));
    }

    setFiles([...files, ...accepted]);
  };

  const handleRemoveFile = (indexToRemove) => {
    setFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
  };

  const handleDragStart = (event) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event) => {
    if (!isSortableEnabled) return;

    const { active, over } = event;
    if (active && over && active.id !== over.id) {
      setFiles((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
    setActiveId(null);
  };

  const handleDragCancel = () => {
    setActiveId(null);
  };

  const handleClearAll = () => {
    setFiles([]);
    setError('');
    setNotice('');
  };

  const handleSubmit = async () => {
    if (files.length === 0 || inFlightRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;
    inFlightRef.current = true;
    setIsLoading(true);
    setError('');
    setNotice('');

    try {
      const rawFilesArray = files.map(item => item.file);
      const result = await runConversion(config, rawFilesArray, controller.signal);
      // Смена инструмента или роута снимает форму: скачивание и баннеры
      // прилетели бы уже в несуществующий экран.
      if (controller.signal.aborted) return;
      downloadBlob(result.blob, result.filename);
      if (result.notice) setNotice(result.notice);
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error(err);
      setError(humanizeError(err.message));
    } finally {
      abortRef.current = null;
      inFlightRef.current = false;
      setIsLoading(false);
    }
  };

  // Находим объект файла, который сейчас перетаскивают, для оверлея
  const activeItem = files.find(f => f.id === activeId);

  return (
    <>
      <nav aria-label="Хлебные крошки" className="w-full self-start text-xs text-text-secondary">
        <Link to="/" className="hover:text-primary transition-colors">Главная</Link>
        <span className="mx-1.5" aria-hidden="true">›</span>
        <span>{config.sourceName} в {config.targetName}</span>
      </nav>

      {/* ... Верхняя часть (заголовки и инпуты) без изменений ... */}
      <div className="text-center">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl text-text-primary">
          Конвертация {config.sourceName} в {config.targetName}
        </h1>
        <p className="mt-2 text-text-secondary">
          {config.description || `Быстрый и безопасный способ превратить ваши файлы в аккуратный ${config.targetName} документ`}
        </p>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileInput}
        accept={config.accept}
        disabled={isLoading}
      />

      <div
        role="button"
        tabIndex={isLoading ? -1 : 0}
        aria-disabled={isLoading}
        aria-label={`Добавить файлы (${config.sourceName}) для конвертации в ${config.targetName}, максимум ${config.maxFiles} шт.`}
        onKeyDown={(e) => {
          if (isLoading) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onButtonClick();
          }
        }}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={onButtonClick}
        className={`w-full max-w-xl aspect-video border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-center p-6 cursor-pointer transition select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
          isDragActive
            ? 'bg-primary/5 border-primary text-primary scale-[1.01]'
            : 'bg-surface-muted border-ui-border text-text-secondary hover:bg-surface-muted/80 hover:border-text-secondary/40'
        } ${isLoading ? 'pointer-events-none opacity-50' : ''}`}
      >
        <div className={`mb-3 transition-transform duration-200 ${isDragActive ? 'scale-110' : ''}`}>
          {isLoading ? (
            <svg className="animate-spin h-10 w-10 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          ) : isDragActive ? (
            <svg className="h-10 w-10 text-current" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          ) : (
            <svg className="h-10 w-10 text-current" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          )}
        </div>

        <span className="font-semibold text-base md:text-lg text-text-primary">
          {isLoading ? 'Обработка файлов на сервере...' : isDragActive ? 'Сбросьте файлы сюда' : 'Перетащите файлы сюда или нажмите для выбора'}
        </span>
        <span className="text-xs text-text-secondary font-normal mt-2">
          {isLoading ? 'Пожалуйста, не закрывайте вкладку' : `Поддерживаются только файлы с расширением ${config.sourceName} (Макс: ${config.maxFiles} шт., ${MAX_FILE_SIZE_MB} МБ${config.target === 'pdf' ? ' суммарно' : ' на файл'})`}
        </span>
      </div>

      {error && (
        <div className="w-full max-w-xl bg-error/10 border-l-4 border-error p-4 rounded-r-xl text-sm text-error font-medium">
          {error}
        </div>
      )}

      {notice && (
        <div className="w-full max-w-xl bg-warning/10 border-l-4 border-warning p-4 rounded-r-xl text-sm text-warning font-medium">
          {notice}
        </div>
      )}

      {files.length > 0 && (
        <div className="w-full max-w-xl flex flex-col gap-3 animate-fadeIn">
          <div className="w-full text-sm text-text-secondary flex justify-between px-1 items-center">
            <span>Выбрано файлов: <span className="font-bold text-text-primary">{files.length}</span> из {config.maxFiles}</span>
            {!isLoading && (
              <button onClick={handleClearAll} className="min-h-11 inline-flex items-center text-error hover:underline font-medium text-xs">Очистить список</button>
            )}
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart} // <-- Подключили
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel} // <-- Подключили
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          >
            <SortableContext items={files.map(f => f.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-ui-border [&::-webkit-scrollbar-thumb]:rounded-full">
                {files.map((item, index) => (
                  <SortableFileItem
                    key={item.id}
                    id={item.id}
                    item={item}
                    index={index}
                    onRemove={handleRemoveFile}
                    isLoading={isLoading}
                    isSortableEnabled={isSortableEnabled}
                  />
                ))}
              </div>
            </SortableContext>

            {/* 3. САМ ОВЕРЛЕЙ: отвечает за красивый полет клона над интерфейсом */}
            <DragOverlay>
              {activeItem ? (
                <FileItemView
                  item={activeItem}
                  index={files.findIndex(f => f.id === activeId)}
                  isLoading={isLoading}
                  isSortableEnabled={isSortableEnabled}
                  isOverlay
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      {/* ... Нижняя кнопка конвертации и футер без изменений ... */}
      {files.length > 0 && (
        <button
          onClick={handleSubmit}
          disabled={isLoading}
          className={`w-full max-w-xl text-white font-bold py-3.5 px-6 rounded-xl transition flex items-center justify-center gap-2 ${
            isLoading
              ? 'bg-primary/50 cursor-not-allowed'
              : 'bg-primary hover:bg-primary-hover active:scale-[0.99]'
          }`}
        >
          {isLoading ? (
            <>
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>Пожалуйста, подождите...</span>
            </>
          ) : (
            <span>Конвертировать в {config.targetName}</span>
          )}
        </button>
      )}

      <div className="w-full max-w-2xl border-t border-ui-border pt-6">
        <h3 className="font-semibold text-lg mb-2 text-text-primary">Как это работает:</h3>
        <ol className="list-decimal pl-5 space-y-1 text-text-secondary text-base">
          {steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </div>

      {/* Текстовый блок инструмента: чем он отличается от соседних, что произойдёт
          с файлом и какие у него лимиты. native details вместо аккордеона с состоянием
          отвечает на вопрос без JS — текст остаётся в prerender-HTML. */}
      <div className="w-full max-w-2xl border-t border-ui-border pt-6 space-y-6">
        <section>
          <h2 className="font-semibold text-lg mb-3 text-text-primary">
            Что нужно знать про {config.sourceName} и {config.targetName}
          </h2>
          <div className="space-y-3 text-base leading-relaxed text-text-secondary">
            {config.about.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </section>

        <section>
          <h3 className="font-semibold text-lg mb-3 text-text-primary">Частые вопросы</h3>
          <div className="space-y-2">
            {config.faq.map((item, index) => (
              <details
                key={index}
                className="group rounded-xl border border-ui-border bg-main"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 text-base font-semibold text-text-primary [&::-webkit-details-marker]:hidden">
                  <span>{item.q}</span>
                  <svg className="h-3 w-3 shrink-0 fill-current text-text-secondary transition-transform duration-200 group-open:rotate-180" viewBox="0 0 20 20" aria-hidden="true">
                    <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" />
                  </svg>
                </summary>
                <p className="px-4 pb-4 text-base leading-relaxed text-text-secondary">{item.a}</p>
              </details>
            ))}
          </div>
        </section>
      </div>

      <div className="w-full max-w-2xl border-t border-ui-border pt-6">
        <h3 className="font-semibold text-lg mb-3 text-text-primary">Другие конвертеры</h3>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {relatedTools.map(([otherSlug, tool]) => (
            <li key={otherSlug}>
              <Link
                to={`/tool/${otherSlug}`}
                className="flex min-h-11 items-center gap-2 rounded-xl border border-ui-border bg-surface-muted px-3 py-2 text-sm text-text-primary hover:border-primary hover:bg-primary-light transition-colors"
              >
                <span aria-hidden="true">{tool.icon}</span>
                <span className="truncate">{tool.sourceName} в {tool.targetName}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}