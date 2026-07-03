from django.urls import path
from .views import (
    ImagesToPdfView,
    PdfToImagesView,
    GenericConvertView,
    TaskStatusView,
    FileDownloadView
)

urlpatterns = [
    path('api/images-to-pdf/', ImagesToPdfView.as_view(), name='images_to_pdf'),
    path('api/pdf-to-images/', PdfToImagesView.as_view(), name='pdf_to_images'),
    path('api/convert/', GenericConvertView.as_view(), name='generic_convert'),

    # Новые системные эндпоинты Celery
    path('api/status/<str:task_id>/', TaskStatusView.as_view(), name='task_status'),
    path('api/download/<str:filename>/', FileDownloadView.as_view(), name='file_download'),
]