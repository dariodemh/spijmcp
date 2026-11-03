# -*- coding: utf-8 -*-
"""Genera la guía para abogados en DOCX (luego se exporta a PDF)."""

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
with open(os.path.join(BASE, "package.json"), encoding="utf-8") as f:
    VERSION = json.load(f)["version"]

AZUL = RGBColor(0x12, 0x33, 0x5C)
AZUL_CLARO = RGBColor(0x1C, 0x46, 0x7A)
GRIS = RGBColor(0x5A, 0x64, 0x70)
VERDE = RGBColor(0x1E, 0x6B, 0x4F)


def sombrear(celda, color_hex):
    tcPr = celda._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), color_hex)
    tcPr.append(shd)


def borde_izquierdo(celda, color_hex):
    tcPr = celda._tc.get_or_add_tcPr()
    bordes = OxmlElement("w:tcBorders")
    izq = OxmlElement("w:left")
    izq.set(qn("w:val"), "single")
    izq.set(qn("w:sz"), "18")
    izq.set(qn("w:space"), "0")
    izq.set(qn("w:color"), color_hex)
    bordes.append(izq)
    tcPr.append(bordes)


def parrafo(doc, texto="", tam=10.5, negrita=False, color=None, espacio=4, alineacion=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(espacio)
    p.paragraph_format.line_spacing = 1.12
    if alineacion is not None:
        p.alignment = alineacion
    run = p.add_run(texto)
    run.font.size = Pt(tam)
    run.font.bold = negrita
    if color is not None:
        run.font.color.rgb = color
    return p


def titulo(doc, texto):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(texto)
    r.font.size = Pt(26)
    r.font.bold = True
    r.font.color.rgb = AZUL
    return p


def subtitulo(doc, texto):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(14)
    r = p.add_run(texto)
    r.font.size = Pt(11.5)
    r.font.color.rgb = GRIS
    return p


def seccion(doc, numero, texto):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(f"{numero}. {texto}")
    r.font.size = Pt(14)
    r.font.bold = True
    r.font.color.rgb = AZUL_CLARO
    return p


def vineta(doc, texto, negrita_hasta=None):
    p = doc.add_paragraph(style="List Bullet")
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.line_spacing = 1.1
    if negrita_hasta:
        r1 = p.add_run(negrita_hasta)
        r1.font.bold = True
        r1.font.size = Pt(10.5)
    r2 = p.add_run(texto)
    r2.font.size = Pt(10.5)
    return p


def paso(doc, numero, texto):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.left_indent = Cm(0.6)
    p.paragraph_format.first_line_indent = Cm(-0.6)
    r1 = p.add_run(f"{numero}. ")
    r1.font.bold = True
    r1.font.size = Pt(10.5)
    r1.font.color.rgb = AZUL_CLARO
    r2 = p.add_run(texto)
    r2.font.size = Pt(10.5)
    return p


def recuadro(doc, titulo_texto, cuerpo, color_fondo="EAF2FB", color_borde="1C467A"):
    tabla = doc.add_table(rows=1, cols=1)
    tabla.alignment = WD_TABLE_ALIGNMENT.CENTER
    celda = tabla.cell(0, 0)
    sombrear(celda, color_fondo)
    borde_izquierdo(celda, color_borde)
    celda.paragraphs[0].text = ""
    p = celda.paragraphs[0]
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(titulo_texto)
    r.font.bold = True
    r.font.size = Pt(10.5)
    r.font.color.rgb = AZUL
    p2 = celda.add_paragraph()
    p2.paragraph_format.space_after = Pt(2)
    r2 = p2.add_run(cuerpo)
    r2.font.size = Pt(10)
    return tabla


def tabla_problemas(doc, filas):
    tabla = doc.add_table(rows=1, cols=2)
    tabla.style = "Table Grid"
    encabezados = tabla.rows[0].cells
    for i, texto in enumerate(("Situación", "Qué hacer")):
        sombrear(encabezados[i], "12335C")
        p = encabezados[i].paragraphs[0]
        r = p.add_run(texto)
        r.font.bold = True
        r.font.size = Pt(10)
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    for situacion, accion in filas:
        celdas = tabla.add_row().cells
        p = celdas[0].paragraphs[0]
        r = p.add_run(situacion)
        r.font.size = Pt(9.5)
        p2 = celdas[1].paragraphs[0]
        r2 = p2.add_run(accion)
        r2.font.size = Pt(9.5)
    return tabla


def main():
    doc = Document()

    seccion_pagina = doc.sections[0]
    seccion_pagina.page_width = Cm(21)
    seccion_pagina.page_height = Cm(29.7)
    seccion_pagina.top_margin = Cm(2.0)
    seccion_pagina.bottom_margin = Cm(2.0)
    seccion_pagina.left_margin = Cm(2.2)
    seccion_pagina.right_margin = Cm(2.2)

    estilo = doc.styles["Normal"]
    estilo.font.name = "Calibri"
    estilo.font.size = Pt(10.5)

    titulo(doc, "SPIJ en Claude")
    subtitulo(doc, "Guía de instalación y uso para abogados")

    parrafo(
        doc,
        "Esta extensión permite buscar normas y jurisprudencia del SPIJ (Sistema Peruano de "
        "Información Jurídica) directamente en Claude, con sumillas, números y enlaces reales. "
        "Todo se ejecuta en tu computadora: no hay servidores intermedios ni se comparte tu cuenta.",
        tam=10.5,
        espacio=6,
    )

    seccion(doc, 1, "Antes de empezar")
    vineta(doc, " instalado en tu computadora.", negrita_hasta="Claude Desktop")
    vineta(doc, f" spij-mcp-{VERSION}.mcpb, descargado de la página de releases del proyecto.", negrita_hasta="El archivo")
    vineta(
        doc,
        " usuario y contraseña del SPIJ. Es opcional: sin cuenta verás metadatos y sumillas; "
        "con cuenta, el texto completo de las resoluciones.",
        negrita_hasta="Tu cuenta del SPIJ:",
    )

    seccion(doc, 2, "Instalar en cuatro pasos")
    paso(doc, 1, "Descarga el archivo .mcpb desde la última release del repositorio.")
    paso(doc, 2, "Abre Claude Desktop.")
    paso(
        doc,
        3,
        "Haz doble clic sobre el archivo descargado, o ve a Configuración → Extensiones y arrástralo ahí.",
    )
    paso(
        doc,
        4,
        "Si tienes cuenta del SPIJ, escribe tu usuario y contraseña en el formulario que aparece. "
        "Si no, deja los campos vacíos.",
    )
    parrafo(doc, "", espacio=2)
    recuadro(
        doc,
        "Si no ves el menú Extensiones",
        "Actualiza Claude Desktop a la última versión y vuelve a intentarlo. Cerrar y abrir la aplicación "
        "por completo (no solo la ventana) hace que la extensión cargue.",
    )

    seccion(doc, 3, "Comprobar que funciona")
    parrafo(doc, "En el chat, escribe:", espacio=2)
    recuadro(doc, "Ejemplo", "«Ejecuta diagnostico_spij y dime el estado.»")
    parrafo(
        doc,
        "Debe responder con el modo de acceso (libre o suscriptor), la versión instalada y la cantidad "
        "de normas y documentos disponibles.",
        espacio=6,
    )

    seccion(doc, 4, "Qué puedes pedirle")
    vineta(doc, "Busca casaciones laborales de 2025 sobre despido arbitrario y hazme un cuadro con número, fecha y sumilla.")
    vineta(doc, "¿Qué normas se publicaron esta semana sobre contrataciones del Estado?")
    vineta(doc, "Encuentra jurisprudencia del Tribunal Constitucional sobre el derecho al agua.")
    vineta(doc, "Busca el TUO de la Ley 27444 vigente y tráeme el artículo 207.")
    vineta(doc, "Pásame en Word el TUO del Decreto Legislativo 1034.")
    vineta(doc, "Descarga el PDF del anexo del Decreto Supremo 111-2024-PCM.")
    parrafo(
        doc,
        "Para resultados precisos, da el número de la norma o del expediente. Si solo das el nombre y hay "
        "varias posibles, Claude te preguntará cuál. Los archivos en Word o PDF se guardan en la carpeta "
        "Descargas\\SPIJ de tu computadora.",
        espacio=6,
    )

    seccion(doc, 5, "Texto completo de las resoluciones")
    parrafo(
        doc,
        "El acceso libre del SPIJ entrega metadatos y sumillas. Para leer el texto completo de casaciones, "
        "sentencias y expedientes necesitas una cuenta de suscriptor del SPIJ, configurada en el paso 4. "
        "Si un documento no está disponible, Claude te lo indicará y podrás abrirlo en el SPIJ con tu sesión.",
        espacio=6,
    )

    seccion(doc, 6, "Actualizaciones")
    parrafo(
        doc,
        "Pregunta en el chat «¿Hay actualizaciones del conector del SPIJ?». Claude consultará el repositorio "
        "y te dirá la versión instalada, la última publicada y el enlace de descarga. Para actualizar, instala "
        "el nuevo .mcpb igual que la primera vez: reemplaza al anterior y conserva tu configuración.",
        espacio=6,
    )

    recuadro(
        doc,
        "Secreto profesional",
        "No incluyas nombres, DNI ni datos de clientes en las consultas. Busca por materia, número de "
        "casación o tema. Las consultas se envían al SPIJ y al proveedor del modelo de IA. Verifica siempre "
        "la resolución original antes de citarla en un escrito.",
        color_fondo="FFF4E5",
        color_borde="C77A1A",
    )

    seccion(doc, 7, "Problemas comunes")
    tabla_problemas(
        doc,
        [
            ("No aparece la extensión", "Revisa la versión de Claude Desktop y reinicia la aplicación por completo."),
            ("Error 401 o 403 al buscar", "Sesión caducada o red bloqueada; espera un minuto y reintenta."),
            ("Tarda o no conecta", "Posible bloqueo geográfico del SPIJ; prueba sin VPN o desde otra red."),
            ("«texto_disponible: false»", "Documento reservado a suscriptores: configura tu cuenta del SPIJ."),
            ("No encuentra resultados", "Usa menos filtros, sin comillas, o prueba con otro término."),
        ],
    )

    parrafo(doc, "", espacio=10)
    parrafo(
        doc,
        f"Documentación del proyecto: github.com/dariodemh/spijmcp  ·  Versión {VERSION}",
        tam=8.5,
        color=GRIS,
        alineacion=WD_ALIGN_PARAGRAPH.CENTER,
    )

    salida_docx = os.path.join(BASE, "dist", "SPIJ-en-Claude-Guia.docx")
    os.makedirs(os.path.dirname(salida_docx), exist_ok=True)
    doc.save(salida_docx)
    print(salida_docx)


if __name__ == "__main__":
    main()
