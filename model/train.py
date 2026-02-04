import modal

app = modal.App("riftbound-yolo-train")

# Container image with all training dependencies
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

# Persistent volume for storing training results
volume = modal.Volume.from_name("riftbound-model", create_if_missing=True)

REMOTE_DATASET_DIR = "/data/dataset"
REMOTE_RUNS_DIR = "/data/runs"


@app.local_entrypoint()
def main(skip_upload: bool = False, export_only: bool = False):
    """
    Uploads the local dataset and launches cloud training on Modal.

    Handles three workflows: full pipeline (upload + train + download),
    train-only (reuse uploaded dataset), and export-only (download a
    previously trained model).

    Arguments:
        skip_upload: Skip dataset upload if already on the volume.
        export_only: Only export and download an existing trained model.

    Usage:
        modal run train.py                  # Upload dataset + train
        modal run train.py --skip-upload    # Train only (dataset already uploaded)
        modal run train.py --export-only    # Export and download (already trained)
    """
    import pathlib

    base_dir = pathlib.Path(__file__).parent

    if export_only:
        print("Exporting existing model...")
        export_model_fn.remote()

        print("Downloading results...")
        output_dir = base_dir / "runs"
        output_dir.mkdir(exist_ok=True)
        _download_results(output_dir)
        print(f"Results saved to {output_dir}")
        _copy_model_to_public(base_dir)
        return

    if not skip_upload:
        _upload_dataset(base_dir)
    else:
        print("Skipping dataset upload (--skip-upload)")

    print("Starting training...")
    train_model.remote()

    # Download results
    print("Downloading trained model...")
    output_dir = base_dir / "runs"
    output_dir.mkdir(exist_ok=True)

    _download_results(output_dir)
    print(f"Results saved to {output_dir}")
    _copy_model_to_public(base_dir)


def _upload_dataset(base_dir):
    """
    Compresses and uploads the local dataset to the Modal volume.

    Computes a SHA-256 hash of the dataset directory contents (file
    names and sizes) to detect changes. Reuses the existing archive
    if the dataset hasn't changed since the last upload.

    Arguments:
        base_dir: The model directory containing the dataset folder.
    """
    import hashlib
    import tarfile

    dataset_dir = base_dir / "dataset"
    if not dataset_dir.exists():
        print("ERROR: model/dataset/ not found. Run data_creator.py first.")
        return

    archive_path = base_dir / "dataset.tar.gz"
    hash_path = base_dir / "dataset.tar.gz.sha256"

    # Hash current dataset based on file list + sizes
    hasher = hashlib.sha256()
    for f in sorted(dataset_dir.rglob("*")):
        if f.is_file():
            hasher.update(f"{f.relative_to(dataset_dir)}:{f.stat().st_size}\n".encode())
    current_hash = hasher.hexdigest()

    # Check if the existing archive matches
    previous_hash = hash_path.read_text().strip() if hash_path.exists() else ""

    if archive_path.exists() and current_hash == previous_hash:
        print("Dataset unchanged, reusing existing archive.")
    else:
        print("Compressing dataset...")
        with tarfile.open(str(archive_path), "w:gz") as tar:
            for item in dataset_dir.iterdir():
                tar.add(str(item), arcname=item.name)
        hash_path.write_text(current_hash)
        archive_size = archive_path.stat().st_size / (1024 * 1024)
        print(f"Dataset compressed: {archive_size:.1f} MB")

    print("Uploading to Modal...")
    with volume.batch_upload(force=True) as batch:
        batch.put_file(str(archive_path), "dataset.tar.gz")
    print("Dataset uploaded.")


def _copy_model_to_public(base_dir):
    """
    Copies the exported TF.js model to the public web app directory.

    Arguments:
        base_dir: The model directory containing the runs folder.
    """
    import shutil

    src = base_dir / "runs" / "train" / "weights" / "best_web_model"
    dst = base_dir.parent / "public" / "models" / "yolo11n-obb-riftbound"

    if not src.exists():
        print(f"Model not found at {src}, skipping copy to public/")
        return

    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    print(f"Model copied to {dst}")


def _download_results(local_dir):
    """
    Downloads training results from the Modal volume to a local directory.

    Iterates over all files in the volume's runs directory and writes
    them to the corresponding local paths.

    Arguments:
        local_dir: The local directory to save the results to.
    """
    import pathlib

    for entry in volume.listdir("runs", recursive=True):
        # entry.path includes the "runs/" prefix, strip it to avoid runs/runs/
        rel = entry.path.removeprefix("runs/")
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
    """
    Exports a trained YOLO model to TensorFlow.js format.

    Loads the best checkpoint from a previous training run and
    exports it. Uses CPU device and opset 12 for maximum
    compatibility with browser runtimes.
    """
    import os
    from ultralytics import YOLO

    volume.reload()

    best_path = os.path.join(REMOTE_RUNS_DIR, "train", "weights", "best.pt")
    if not os.path.exists(best_path):
        raise FileNotFoundError(f"Model not found at {best_path}. Train first.")

    print("Exporting model to TensorFlow.js...")
    model = YOLO(best_path)
    model.export(format="tfjs", imgsz=640, device="cpu", opset=12)

    volume.commit()
    print("Export complete.")


@app.function(
    image=image,
    gpu="T4",
    timeout=3600,
    volumes={"/data": volume},
)
def train_model():
    """
    Trains a YOLO11n-OBB model on a remote Modal GPU.

    Extracts the dataset archive, rewrites data.yaml with remote
    paths, runs YOLO training, exports the best model to TF.js,
    and commits the results to the persistent volume.
    """
    import os
    import shutil
    from ultralytics import YOLO

    volume.reload()

    print(f"Contents of /data/: {os.listdir('/data/')}")

    # Extract dataset from archive
    archive_path = "/data/dataset.tar.gz"
    if os.path.exists(archive_path):
        print(f"Archive found: {archive_path} ({os.path.getsize(archive_path)} bytes)")
        print("Extracting dataset...")
        if os.path.exists(REMOTE_DATASET_DIR):
            shutil.rmtree(REMOTE_DATASET_DIR)
        os.makedirs(REMOTE_DATASET_DIR, exist_ok=True)
        shutil.unpack_archive(archive_path, REMOTE_DATASET_DIR)
        print(f"Contents of {REMOTE_DATASET_DIR}: {os.listdir(REMOTE_DATASET_DIR)}")
    else:
        print(f"Archive not found at {archive_path}")

    # Verify dataset structure
    if not os.path.exists(os.path.join(REMOTE_DATASET_DIR, "train")):
        _print_dataset_debug(REMOTE_DATASET_DIR)
        raise FileNotFoundError(
            f"Dataset not found at {REMOTE_DATASET_DIR}. "
            "Run without --skip-upload to upload the dataset."
        )

    # Rewrite data.yaml with remote paths
    yaml_path = os.path.join(REMOTE_DATASET_DIR, "data.yaml")
    with open(yaml_path, "w") as f:
        f.write(
            f"path: {REMOTE_DATASET_DIR}\n"
            "train: train/images\n"
            "val: val/images\n\n"
            "nc: 1\n"
            "names: ['card']\n"
        )

    # Train
    model = YOLO("yolo11n-obb.pt")
    model.train(
        data=yaml_path,
        epochs=20,
        imgsz=640,
        batch=32,
        device=0,
        task="obb",
        project=REMOTE_RUNS_DIR,
        name="train",
    )

    # Export to TensorFlow.js (CPU + opset 12 for browser compatibility)
    print("Exporting model to TensorFlow.js...")
    best_path = os.path.join(REMOTE_RUNS_DIR, "train", "weights", "best.pt")
    export_model = YOLO(best_path)
    export_model.export(format="tfjs", imgsz=640, device="cpu", opset=12)

    volume.commit()
    print("Training and export complete.")


def _print_dataset_debug(dataset_dir: str) -> None:
    """
    Prints a limited directory listing for debugging dataset issues.

    Walks at most 10 directories to avoid expensive traversal on
    large or deeply nested directory trees.

    Arguments:
        dataset_dir: The root directory to inspect.
    """
    import os

    count = 0
    for root, dirs, files in os.walk(dataset_dir):
        print(f"  {root}: dirs={dirs[:5]}, files={len(files)} files")
        count += 1
        if count >= 10:
            break
