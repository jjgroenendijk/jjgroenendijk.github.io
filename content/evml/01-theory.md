---
weight: 1
title: "Machine Vision Basics"
---

### Machine Vision Basic Steps

1. **Image Acquisition** 
   - Process of capturing an image through a sensor or camera.
   - Types of images: 
     - **Reflection images**: Generated when light reflects off the surface.
     - **Emission images**: Generated by the emission of light from the object.
     - **Absorption images**: Formed by light absorption in the object.

2. **Preprocessing**
   - Often used to correct non-uniform lighting or remove noise.
   - Common techniques: 
     - Histogram equalization for contrast adjustment.
     - Smoothing filters to remove noise (e.g., Gaussian filter).

3. **Segmentation**
   - Divides the image into meaningful parts or objects.
   - Key for separating distinct objects from one another.

4. **Labeling**
   - Assigns identifiers (labels) to segmented objects (e.g., assigning a number to each object).

5. **Feature Extraction**
   - Involves calculating object properties such as perimeter or area, used for classification.

6. **Classification**
   - Final step where conclusions are drawn based on extracted features.
   - Could involve machine learning algorithms to identify or classify objects.

### Image Processing Concepts

- **From Top to Bottom**: As data moves through the steps, it becomes more abstract (higher-level features).
- **From Bottom to Top**: Data size increases (e.g., pixel-level data is large, while abstracted features are small).

---

### Image Concepts

- **Digital Image**: A 2D image representation using a finite number of points, called **pixels**.
- **Common Image Formats**:
  - **Binary Images**: Consists of only two colors (usually black and white).
  - **Grayscale Images**: Uses shades of gray between black and white.

---

### Pixel Relationships

- **4-adjacency**: Pixels \(p\) and \(q\) are considered adjacent if they are connected horizontally or vertically.
- **8-adjacency**: Pixels \(p\) and \(q\) are adjacent if connected diagonally, horizontally, or vertically.

---

### Color Formats

- **Subtractive Color (Paint)**: Color is produced by subtracting light (e.g., cyan, magenta, yellow).
- **Additive Color (Light)**: Color is produced by adding light (e.g., red, green, blue).

---

### Indexed Image

- Saves memory and storage space by storing only the colors that appear in the image.

---

### Perceptual Color Space (Human Perception)

- **Hue**: The actual color.
- **Saturation**: The intensity of the color.
- **Brightness**: Lightness or darkness of the color.

---

### Brightness Calculation (for RGB images)

**Brightness** = 0.2989 * Red + 0.5870 * Green + 0.1140 Blue

---

### Light Spectrum

- Visible light wavelengths range from **380 nm to 780 nm**.

---

### Weber's Law

- Humans can detect a 1% difference in luminance, typically measured in candela per square meter (\(cd/m^2\)).

---

### Spatial Resolution

- Defines the density of pixels in an image, measured in **dots per inch (dpi)**.
- The higher the spatial resolution, the more detail is present in the image.

---

### Image Digitization

1. **Sampling**: Converts a continuous image into discrete samples.
   - Moiré patterns can arise from improper sampling.

2. **Quantization**: Maps the amplitude of the image to discrete levels.
   - Example: The "wagon wheel effect" can be observed when objects like helicopter blades appear to spin backward due to improper sampling.

---

### Nyquist Theorem:

- For accurate digitization, the sampling rate should be at least **twice the highest frequency** present in the signal.