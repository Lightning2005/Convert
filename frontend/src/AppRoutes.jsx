import { Route, Routes } from 'react-router-dom';
import MainLayout from './components/MainLayout';
import Seo from './components/Seo';
import HomePage from './pages/HomePage';
import ConverterPage from './pages/ConverterPage';
import PrivacyPage from './pages/PrivacyPage';
import ContactsPage from './pages/ContactsPage';
import NotFoundPage from './pages/NotFoundPage';

/** Дерево приложения без роутера — используют клиент и сборщик статических страниц. */
export default function AppRoutes() {
  return (
    <>
      <Seo />
      <MainLayout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/tool/:slug" element={<ConverterPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </MainLayout>
    </>
  );
}
