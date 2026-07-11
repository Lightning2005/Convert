import React, { useState, useRef, useEffect } from 'react';
import { runConversion, downloadBlob } from '../services/api';
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
            className="cursor-grab active:cursor-grabbing p-1 text-text-secondary hover:text-text-primary rounded-md hover:bg-surface-muted transition-colors shrink-0 flex items-center"
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
          className="ml-2 p-1.5 text-text-secondary hover:text-error rounded-lg hover:bg-surface-muted transition-colors flex items-center justify-center shrink-0"
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

export default function ConverterForm({ config, slug, preloadedFiles }) {
  const [files, setFiles] = useState([]);
  const [activeId, setActiveId] = useState(null); // <-- Храним ID файла, который сейчас тащат
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef(null);

  const isSortableEnabled = config.targetName?.toUpperCase() === 'PDF';

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  useEffect(() => {
    if (preloadedFiles && preloadedFiles.length > 0) {
      setFiles(preloadedFiles.map((file, idx) => ({
        id: `preload-${idx}-${file.name}-${file.size}`,
        file
      })));
    }
  }, [preloadedFiles, slug]);

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
  };

  const onButtonClick = () => {
    fileInputRef.current.click();
  };

  const handleFiles = (newFiles) => {
    setError('');
    const allowedExts = config.accept.toLowerCase().split(',').map((s) => s.trim());

    const filtered = newFiles.filter((file) => {
      const ext = `.${file.name.split('.').pop().toLowerCase()}`;
      return allowedExts.includes(ext);
    });

    if (filtered.length === 0) {
      setError(`Пожалуйста, выберите файлы в формате ${config.sourceName}`);
      return;
    }

    setFiles((prev) => {
      const withIds = filtered.map((file, idx) => ({
        id: `${file.name}-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 5)}`,
        file
      }));
      const updatedList = [...prev, ...withIds];
      if (updatedList.length > config.maxFiles) {
        setError(`Превышен лимит! Для этого инструмента можно выбрать не более ${config.maxFiles} файлов.`);
        return prev;
      }
      return updatedList;
    });
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

  const handleSubmit = async () => {
    if (files.length === 0) return;

    setIsLoading(true);
    setError('');

    try {
      const rawFilesArray = files.map(item => item.file);
      const { blob, filename } = await runConversion(config, rawFilesArray);
      downloadBlob(blob, filename);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Произошла ошибка при отправке запроса на сервер.');
    } finally {
      setIsLoading(false);
    }
  };

  // Находим объект файла, который сейчас перетаскивают, для оверлея
  const activeItem = files.find(f => f.id === activeId);

  return (
    <>
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
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={onButtonClick}
        className={`w-full max-w-xl aspect-video border-2 border-dashed rounded-2xl flex flex-col items-center justify-center text-center p-6 cursor-pointer transition select-none ${
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
          {isLoading ? 'Пожалуйста, не закрывайте вкладку' : `Поддерживаются только файлы с расширением ${config.sourceName} (Макс: ${config.maxFiles} шт.)`}
        </span>
      </div>

      {error && (
        <div className="w-full max-w-xl bg-error/10 border-l-4 border-error p-4 rounded-r-xl text-sm text-error font-medium">
          {error}
        </div>
      )}

      {files.length > 0 && (
        <div className="w-full max-w-xl flex flex-col gap-3 animate-fadeIn">
          <div className="w-full text-sm text-text-secondary flex justify-between px-1 items-center">
            <span>Выбрано файлов: <span className="font-bold text-text-primary">{files.length}</span> из {config.maxFiles}</span>
            {!isLoading && (
              <button onClick={() => setFiles([])} className="text-error hover:underline font-medium text-xs">Очистить список</button>
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
        <ul className="list-disc pl-5 space-y-1 text-text-secondary text-sm">
          <li>Перетащите файлы в зону выше или нажмите для выбора</li>
          {isSortableEnabled && <li>Настройте нужный порядок файлов с помощью перетаскивания строк</li>}
          <li>Нажмите кнопку «Конвертировать»</li>
          <li>Дождитесь завершения обработки и скачайте готовый {config.targetName}</li>
        </ul>
      </div>
    </>
  );
}