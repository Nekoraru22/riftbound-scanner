# Model Training & Optimization

## Quick Start

1. **Prepare dataset**: `python data_creator.py`
2. **Train model**: `modal run train.py`
3. **Quantize for web**: `modal run quantize.py`

## Quantization

Reduce model size by ~75% and speed up inference 2-4x:

```bash
# Quantize trained model on Modal cloud
modal run quantize.py
```

### Benefits

- **Size**: 4-6 MB → 1-2 MB
- **Speed**: 2-4x faster inference
- **Accuracy**: <1% mAP loss
- **Mobile**: Better performance on low-end devices

### Using Quantized Model

To use the quantized model in the web app:

1. Copy quantized model:

   ```bash
   cp runs/train/weights/best_quantized.onnx ../public/models/
   ```

2. Update `src/lib/yoloDetector.js` to use ONNX Runtime Web instead of TensorFlow.js

3. Install ONNX Runtime Web:

   ```bash
   npm install onnxruntime-web
   ```
