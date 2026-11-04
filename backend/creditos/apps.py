from django.apps import AppConfig


class CreditosConfig(AppConfig):
    name = "creditos"

    def ready(self):
        from . import signals  # noqa: F401
