import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './components/MainLayout';
import HomePage from './pages/HomePage';
import ConverterPage from './pages/ConverterPage';
import PrivacyPage from './pages/PrivacyPage';
import ContactsPage from './pages/ContactsPage';

export default function App() {
  return (
    <BrowserRouter>
      <MainLayout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/tool/:slug" element={<ConverterPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
        </Routes>
      </MainLayout>
    </BrowserRouter>
  );
}