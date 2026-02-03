import os
from PIL import Image

def rotar_horizontales(directorio):
    # Extensiones de imagen comunes
    extensiones = ('.jpg', '.jpeg', '.png', '.bmp', '.webp')
    
    # Comprobar si la carpeta existe
    if not os.path.exists(directorio):
        print(f"La ruta '{directorio}' no existe.")
        return

    print(f"Buscando imágenes en: {directorio}...\n")
    imagenes_rotadas = 0

    for archivo in os.listdir(directorio):
        if archivo.lower().endswith(extensiones):
            ruta_completa = os.path.join(directorio, archivo)
            
            try:
                with Image.open(ruta_completa) as img:
                    ancho, alto = img.size
                    
                    # Si es más ancha que larga (Landscape)
                    if ancho > alto:
                        # Rotate 90 es hacia la izquierda por defecto en Pillow
                        img_rotada = img.rotate(90, expand=True)
                        
                        # Guardar la imagen sobrescribiendo la original
                        # Se usa el formato original para mantener la calidad
                        img_rotada.save(ruta_completa)
                        
                        print(f"[ROTADA] {archivo} ({ancho}x{alto} -> {alto}x{ancho})")
                        imagenes_rotadas += 1
            except Exception as e:
                print(f"[ERROR] No se pudo procesar {archivo}: {e}")

    print(f"\nProceso finalizado. Total de imágenes rotadas: {imagenes_rotadas}")

# --- CONFIGURACIÓN ---
# Cambia '.' por la ruta de tu carpeta si no es la actual
ruta_carpeta = './cards' 
rotar_horizontales(ruta_carpeta)