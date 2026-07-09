import React from 'react';
import { Link } from 'react-router-dom';

export default function PrivacyPage() {
  return (
    <div className="w-full max-w-3xl mx-auto text-left py-4">
      <h1 className="text-3xl font-extrabold text-text-primary mb-6">Политика конфиденциальности</h1>
      <p className="text-sm text-text-secondary mb-8">Последнее обновление: {new Date().toLocaleDateString('ru-RU')}</p>

      <div className="space-y-6 text-sm text-text-secondary leading-relaxed">
        <section>
          <h2 className="text-lg font-bold text-text-primary mb-2">1. Общие положения</h2>
          <p>
            Настоящая Политика конфиденциальности описывает, как веб-сайт «Конверт» обрабатывает и защищает информацию,
            получаемую от пользователей во время использования бесплатного онлайн-сервиса конвертации файлов.
            Мы стремимся обеспечить максимальную безопасность и приватность ваших данных.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-text-primary mb-2">2. Какие данные мы собираем</h2>
          <p>
            Наш сервис <strong>не собирает, не запрашивает и не хранит</strong> персональные данные пользователей, такие как
            имена, адреса электронной почты, номера телефонов или платежную информацию. Вы можете использовать все
            инструменты полностью анонимно без регистрации.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-text-primary mb-2">3. Обработка и удаление файлов</h2>
          <p>
            Все файлы, загружаемые пользователями для конвертации, обрабатываются в изолированных временных директориях
            на сервере. Они используются исключительно для выполнения технической процедуры конвертации (например, из JPG в PDF).
          </p>
          <p className="mt-2 font-medium text-text-primary">
            🔒 Все исходные и сконвертированные файлы автоматически и безвозвратно удаляются с наших серверов ровно через 1 час после завершения сессии.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-text-primary mb-2">4. Безопасность данных</h2>
          <p>
            Передача файлов между вашим устройством и сервером защищена современным протоколом шифрования SSL/TLS.
            Мы не просматриваем содержимое ваших документов, не передаем и не продаем файлы третьим лицам.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-bold text-text-primary mb-2">5. Сторонние сервисы и реклама</h2>
          <p>
            Для модерации и монетизации сайта мы используем Рекламную сеть Яндекса (РСЯ). Сторонние поставщики услуг
            могут использовать файлы куки (cookies) для отображения релевантных рекламных объявлений на основе ваших посещений.
            Вы можете отключить использование куки в настройках своего браузера.
          </p>
        </section>
      </div>

      <div className="mt-10 pt-6 border-t border-ui-border">
        <Link to="/" className="text-primary hover:underline font-medium text-sm">
          ← Вернуться на главную
        </Link>
      </div>
    </div>
  );
}