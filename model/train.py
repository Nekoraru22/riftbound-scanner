import modal

app = modal.App("riftbound-yolo-train")

# Imagen con todas las dependencias
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install(
        "ultralytics",
        "torch",
        "torchvision",
        "opencv-python-headless",
        "tensorflowjs",
    )
)

# Volumen persistente para guardar resultados
volume = modal.Volume.from_name("riftbound-model", create_if_missing=True)

REMOTE_DATASET_DIR = "/data/dataset"
REMOTE_RUNS_DIR = "/data/runs"


@app.local_entrypoint()
def main(skip_upload: bool = False, export_only: bool = False):
    """Sube el dataset local y lanza el entrenamiento en la nube.

    Uso:
        modal run train.py                  # Sube dataset + entrena
        modal run train.py --skip-upload    # Solo entrena (dataset ya subido)
        modal run train.py --export-only    # Solo exporta y descarga (ya entrenado)
    """
    import pathlib

    base_dir = pathlib.Path(__file__).parent

    if export_only:
        print("Exportando modelo existente...")
        export_model_fn.remote()

        print("Descargando resultados...")
        output_dir = base_dir / "runs"
        output_dir.mkdir(exist_ok=True)
        _download_results(output_dir)
        print(f"Resultados guardados en {output_dir}")
        _copy_model_to_public(base_dir)
        return

    if not skip_upload:
        import hashlib

        dataset_dir = base_dir / "dataset"
        if not dataset_dir.exists():
            print("ERROR: No se encontró model/dataset/. Ejecuta primero trainCreator.py")
            return

        archive_path = base_dir / "dataset.tar.gz"
        hash_path = base_dir / "dataset.tar.gz.sha256"

        # Calcular hash del dataset actual (basado en lista de archivos + tamaños)
        hasher = hashlib.sha256()
        for f in sorted(dataset_dir.rglob("*")):
            if f.is_file():
                hasher.update(f"{f.relative_to(dataset_dir)}:{f.stat().st_size}\n".encode())
        current_hash = hasher.hexdigest()

        # Comprobar si el archivo comprimido ya existe y coincide
        previous_hash = hash_path.read_text().strip() if hash_path.exists() else ""

        if archive_path.exists() and current_hash == previous_hash:
            print("Dataset sin cambios, reutilizando archivo comprimido existente.")
        else:
            import tarfile

            print("Comprimiendo dataset...")
            with tarfile.open(str(archive_path), "w:gz") as tar:
                for item in dataset_dir.iterdir():
                    tar.add(str(item), arcname=item.name)
            hash_path.write_text(current_hash)
            archive_size = archive_path.stat().st_size / (1024 * 1024)
            print(f"Dataset comprimido: {archive_size:.1f} MB")

        print("Subiendo a Modal...")
        with volume.batch_upload(force=True) as batch:
            batch.put_file(str(archive_path), "dataset.tar.gz")
        print("Dataset subido.")
    else:
        print("Saltando subida de dataset (--skip-upload)")

    print("Iniciando entrenamiento...")
    train_model.remote()

    # Descargar resultados
    print("Descargando modelo entrenado...")
    output_dir = base_dir / "runs"
    output_dir.mkdir(exist_ok=True)

    _download_results(output_dir)
    print(f"Resultados guardados en {output_dir}")
    _copy_model_to_public(base_dir)


def _copy_model_to_public(base_dir):
    """Copia el modelo TF.js a public/models/ para la app web."""
    import pathlib
    import shutil

    src = base_dir / "runs" / "train" / "weights" / "best_web_model"
    dst = base_dir.parent / "public" / "models" / "yolo11n-obb-riftbound"

    if not src.exists():
        print(f"No se encontró {src}, saltando copia a public/")
        return

    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    print(f"Modelo copiado a {dst}")


def _download_results(local_dir):
    """Descarga los resultados del volumen."""
    import pathlib

    volume_runs = "runs"

    for entry in volume.listdir(volume_runs, recursive=True):
        # entry.path ya incluye el prefijo "runs/", así que lo quitamos
        # para evitar runs/runs/...
        rel = entry.path
        if rel.startswith("runs/"):
            rel = rel[len("runs/"):]

        local_path = pathlib.Path(local_dir) / rel

        if entry.type == modal.volume.FileEntryType.FILE:
            local_path.parent.mkdir(parents=True, exist_ok=True)
            with open(local_path, "wb") as f:
                for chunk in volume.read_file(entry.path):
                    f.write(chunk)


@app.function(
    image=image,
    gpu="T4",
    timeout=600,
    volumes={"/data": volume},
)
def export_model_fn():
    """Exporta el modelo entrenado a TensorFlow.js."""
    import os
    from ultralytics import YOLO

    volume.reload()

    best_path = os.path.join(REMOTE_RUNS_DIR, "train", "weights", "best.pt")
    if not os.path.exists(best_path):
        raise FileNotFoundError(f"No se encontró {best_path}. Entrena primero.")

    print("Exportando modelo a TensorFlow.js...")
    model = YOLO(best_path)
    model.export(format="tfjs", imgsz=640)

    volume.commit()
    print("Exportación completada.")


@app.function(
    image=image,
    gpu="T4",
    timeout=3600,
    volumes={"/data": volume},
)
def train_model():
    """Entrena YOLO11n-OBB en GPU remota de Modal."""
    import os
    from ultralytics import YOLO

    import shutil

    volume.reload()

    # Debug: listar contenido de /data/
    print(f"Contenido de /data/: {os.listdir('/data/')}")

    # Descomprimir dataset si viene como tar.gz
    archive_path = "/data/dataset.tar.gz"
    if os.path.exists(archive_path):
        print(f"Archivo encontrado: {archive_path} ({os.path.getsize(archive_path)} bytes)")
        print("Descomprimiendo dataset...")
        if os.path.exists(REMOTE_DATASET_DIR):
            shutil.rmtree(REMOTE_DATASET_DIR)
        os.makedirs(REMOTE_DATASET_DIR, exist_ok=True)
        shutil.unpack_archive(archive_path, REMOTE_DATASET_DIR)
        print(f"Contenido de {REMOTE_DATASET_DIR}: {os.listdir(REMOTE_DATASET_DIR)}")
    else:
        print(f"No se encontró {archive_path}")

    # Verificar que el dataset existe
    if not os.path.exists(os.path.join(REMOTE_DATASET_DIR, "train")):
        # Buscar train en subdirectorios por si la estructura es diferente
        for root, dirs, files in os.walk(REMOTE_DATASET_DIR):
            print(f"  {root}: dirs={dirs[:5]}, files={len(files)} archivos")
            if len(list(os.walk(root))) > 10:
                break
        raise FileNotFoundError(
            f"No se encontró el dataset en {REMOTE_DATASET_DIR}. "
            "Ejecuta sin --skip-upload para subir el dataset."
        )

    # Reescribir data.yaml con rutas remotas
    data_yaml = f"""\
path: {REMOTE_DATASET_DIR}
train: train/images
val: val/images

nc: 1
names: ['card']
"""
    yaml_path = os.path.join(REMOTE_DATASET_DIR, "data.yaml")
    with open(yaml_path, "w") as f:
        f.write(data_yaml)

    # Entrenar
    model = YOLO("yolo11n-obb.pt")
    model.train(
        data=yaml_path,
        epochs=10,
        imgsz=640,
        batch=32,
        device=0,
        task="obb",
        project=REMOTE_RUNS_DIR,
        name="train",
    )

    # Exportar a TensorFlow.js
    print("Exportando modelo a TensorFlow.js...")
    best_path = os.path.join(REMOTE_RUNS_DIR, "train", "weights", "best.pt")
    export_model = YOLO(best_path)
    export_model.export(format="tfjs", imgsz=640)

    # Commit del volumen para persistir resultados
    volume.commit()

    print("Entrenamiento y exportación completados.")
