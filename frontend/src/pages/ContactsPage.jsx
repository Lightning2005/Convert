import React from 'react';
import { Link } from 'react-router-dom';

export default function ContactsPage() {
  return (
    <div className="w-full max-w-3xl mx-auto text-left py-4">
      <h1 className="text-3xl font-extrabold text-text-primary mb-6">Контакты</h1>
      <p className="text-text-secondary text-sm mb-8">
        Если у вас возникли вопросы по работе сервиса, предложения по сотрудничеству или вы обнаружили ошибку в работе конвертеров, свяжитесь с администрацией проекта. Мы всегда рады обратной связи.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div className="bg-surface-muted p-6 rounded-2xl border border-ui-border/60">
          <span className="text-2xl block mb-2">✉️</span>
          <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider mb-1">Электронная почта</h3>
          <p className="text-secondary text-base font-semibold">
            bykadorovsergey@mail.ru
          </p>
          <p className="text-xs text-text-secondary mt-2">Время ответа составляет от 12 до 24 часов.</p>
        </div>

        <div className="bg-surface-muted p-6 rounded-2xl border border-ui-border/60">
          <span className="text-2xl block mb-2">💻</span>
          <h3 className="font-bold text-text-primary text-sm uppercase tracking-wider mb-1">Разработчик</h3>
          <p className="text-base text-text-primary font-semibold">Сергей Быкадоров</p>
          <a
            href="https://github.com/Lightning2005"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-text-secondary hover:text-primary underline block mt-2"
          >
            Профиль на GitHub
          </a>
        </div>
      </div>

      <div className="mt-12 bg-primary-light border-l-4 border-primary p-4 rounded-r-xl text-sm text-primary-active">
        <strong>Для правообладателей:</strong> Наш сервис не хранит пользовательский контент на постоянной основе. Если вы считаете, что работа сервиса как-либо нарушает ваши права, пожалуйста, направьте детальный запрос на нашу электронную почту.
      </div>

      <div className="mt-10 pt-6 border-t border-ui-border">
        <Link to="/" className="text-primary hover:underline font-medium text-sm">
          ← Вернуться на главную
        </Link>
      </div>
    </div>
  );
}