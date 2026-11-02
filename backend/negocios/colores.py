"""
Colores de marca por negocio. La app pone texto blanco sobre el color primario y
texto del color primario sobre el acento (etiquetas de precio), así que se exige
contraste WCAG AA (4.5:1) en ambos casos: un negocio no puede dejar su POS ilegible.
"""
import re

HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
MINIMO = 4.5


def luminancia(hex_):
    c = [int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def contraste(a, b):
    la, lb = sorted((luminancia(a), luminancia(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def problemas(primario, acento):
    """Lista de problemas en lenguaje del dueño; vacía si la combinación es legible."""
    errores = {}
    for campo, valor in (("color_primario", primario), ("color_acento", acento)):
        if not HEX.match(valor or ""):
            errores[campo] = "Usa un color en formato #RRGGBB."
    if errores:
        return errores
    if contraste("#FFFFFF", primario) < MINIMO:
        errores["color_primario"] = "Es muy claro: el texto blanco del menú y los botones no se leería. Elige uno más oscuro."
    elif contraste(primario, acento) < MINIMO:
        errores["color_acento"] = "No contrasta con el color principal: los precios no se leerían. Elige uno más claro."
    return errores
