Funcion: delete-cloudinary-image

Esta funcion borra una imagen de Cloudinary usando los Secrets guardados en Supabase:
- CLOUDINARY_CLOUD_NAME
- CLOUDINARY_API_KEY
- CLOUDINARY_API_SECRET

Despues de subir este proyecto, despliega la funcion con Supabase CLI:

supabase functions deploy delete-cloudinary-image

El panel ADMIN ya llama esta funcion automaticamente cuando eliminas un producto.
