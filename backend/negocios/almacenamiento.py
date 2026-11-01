"""
Archivos (fotos de productos, logos).

Producción: Cloudflare R2 (compatible con S3). Railway borra el disco en cada
deploy, así que nada se guarda local allá. Variables:
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL
Desarrollo: si no hay R2 configurado se guarda en MEDIA_ROOT.

Toda imagen se normaliza en el servidor (orientación, tamaño máx. 900px, WebP)
para que el POS y el menú carguen rápido en celulares de gama baja.
"""
import io
import uuid
from pathlib import Path

from django.conf import settings
from rest_framework.exceptions import ValidationError

MAX_BYTES = 8 * 1024 * 1024
LADO_MAX = 900


def procesar_imagen(archivo):
    from PIL import Image, ImageOps, UnidentifiedImageError

    if archivo.size > MAX_BYTES:
        raise ValidationError("La imagen pesa más de 8 MB.")
    try:
        img = Image.open(archivo)
        img = ImageOps.exif_transpose(img)
    except (UnidentifiedImageError, OSError):
        raise ValidationError("El archivo no es una imagen válida (usa JPG, PNG o WebP).")
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        fondo = Image.new("RGB", img.size, (255, 255, 255))
        fondo.paste(img, mask=img.split()[-1])
        img = fondo
    else:
        img = img.convert("RGB")
    img.thumbnail((LADO_MAX, LADO_MAX))
    salida = io.BytesIO()
    img.save(salida, "WEBP", quality=80, method=4)
    return salida.getvalue()


def _r2():
    import boto3

    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def usa_r2():
    return bool(getattr(settings, "R2_BUCKET", "") and getattr(settings, "R2_PUBLIC_URL", ""))


def subir_imagen(archivo, carpeta, request):
    """Procesa y sube la imagen. Devuelve la URL pública."""
    datos = procesar_imagen(archivo)
    clave = f"{carpeta.strip('/')}/{uuid.uuid4().hex[:12]}.webp"
    if usa_r2():
        _r2().put_object(Bucket=settings.R2_BUCKET, Key=clave, Body=datos, ContentType="image/webp",
                         CacheControl="public, max-age=31536000, immutable")
        return f"{settings.R2_PUBLIC_URL.rstrip('/')}/{clave}"
    ruta = Path(settings.MEDIA_ROOT) / clave
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_bytes(datos)
    return request.build_absolute_uri(settings.MEDIA_URL + clave)


def borrar(url):
    """Borra un archivo que hayamos subido (ignora URLs externas)."""
    if not url:
        return
    try:
        if usa_r2() and url.startswith(settings.R2_PUBLIC_URL.rstrip("/")):
            clave = url[len(settings.R2_PUBLIC_URL.rstrip("/")) + 1:]
            _r2().delete_object(Bucket=settings.R2_BUCKET, Key=clave)
        elif settings.MEDIA_URL in url:
            clave = url.split(settings.MEDIA_URL, 1)[1]
            (Path(settings.MEDIA_ROOT) / clave).unlink(missing_ok=True)
    except Exception:  # borrar es mejor-esfuerzo: nunca rompe la operación del usuario
        pass
