"""
Crea el Super Admin de CavaTech si no existe (idempotente: se puede correr en cada arranque).
Lee DJANGO_SUPERUSER_USERNAME y DJANGO_SUPERUSER_PASSWORD (y opcional DJANGO_SUPERUSER_EMAIL).
Sin esas variables no hace nada. Nunca cambia la contraseña de un usuario existente.
"""
import os

from django.core.management.base import BaseCommand

from usuarios.models import Usuario


class Command(BaseCommand):
    help = "Crea el Super Admin desde variables de entorno si aún no existe"

    def handle(self, *args, **opts):
        username = os.getenv("DJANGO_SUPERUSER_USERNAME", "").strip()
        password = os.getenv("DJANGO_SUPERUSER_PASSWORD", "")
        if not username or not password:
            self.stdout.write("Sin DJANGO_SUPERUSER_USERNAME/PASSWORD: no se crea Super Admin.")
            return
        if Usuario.objects.filter(username=username).exists():
            self.stdout.write(f"Super Admin '{username}' ya existe.")
            return
        Usuario.objects.create_superuser(username, email=os.getenv("DJANGO_SUPERUSER_EMAIL", ""),
                                         password=password, rol=Usuario.Rol.SUPERADMIN)
        self.stdout.write(self.style.SUCCESS(f"Super Admin '{username}' creado."))
