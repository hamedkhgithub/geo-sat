# GEO Satellite Azimuth / Elevation Calculator

یک Calculator استاتیک برای محاسبه زاویه **Azimuth** متناظر با یک **Elevation** مشخص برای ماهواره‌های زمین‌آهنگ (GEO).

## قابلیت‌ها

- ورود Latitude و Longitude ایستگاه زمینی
- ورود ارتفاع ایستگاه از سطح دریا
- ورود Elevation مطلوب
- محاسبه دو جواب ممکن روی GEO Arc:
  - شاخه شرقی
  - شاخه غربی
- نمایش:
  - Azimuth
  - Longitude ماهواره GEO
  - حداکثر Elevation قابل دستیابی
- تولید جدول Elevation → Azimuth
- نمودار تعاملی Elevation بر حسب Longitude ماهواره GEO با Tooltip
- نمایش Azimuth، Elevation، مختصات ایستگاه و Longitude ماهواره روی نمودار
- مدل زمین WGS-84
- بدون نیاز به Backend یا Dependency
- مناسب برای GitHub Pages

## روش اجرا به صورت Local

فقط فایل `index.html` را در مرورگر باز کنید.

## انتشار روی GitHub Pages

1. یک Repository جدید در GitHub بسازید.
2. محتویات این پروژه را در Root همان Repository قرار دهید.
3. Commit و Push کنید.
4. در GitHub وارد مسیر زیر شوید:

   **Settings → Pages**

5. در بخش **Build and deployment**:
   - Source را روی **Deploy from a branch** بگذارید.
   - Branch را روی `main` قرار دهید.
   - Folder را روی `/(root)` تنظیم کنید.
6. روی Save بزنید.

بعد از فعال شدن Pages، آدرس سایت معمولاً به شکل زیر خواهد بود:

`https://USERNAME.github.io/REPOSITORY-NAME/`

## قرارداد Azimuth

- North = 0°
- East = 90°
- South = 180°
- West = 270°

## فرضیات مداری

- مدار GEO در صفحه استوا
- شعاع ژئوسنتریک مدار GEO: `42164 km`
- مدل زمین: WGS-84

## ساختار پروژه

```text
geo-satellite-calculator/
├── index.html
├── style.css
├── app.js
├── README.md
├── LICENSE
└── .nojekyll
```

## نکته مهندسی

برای یک ایستگاه زمینی ثابت، یک Elevation مشخص معمولاً دو جواب روی قوس GEO دارد؛
یکی در سمت شرق و دیگری در سمت غرب. این ابزار هر دو جواب را محاسبه می‌کند.


## Chart controls (v5)

نمودار تعاملی GEO سه کنترل مهندسی دارد:

- **Tooltip / Sampling Step**: گام نمونه‌برداری Longitude ماهواره، مثلاً `1°` یا `0.1°`. حرکت Tooltip روی همین شبکه کوانتیزه می‌شود.
- **Longitude Range**:
  - `Visible GEO Arc`: فقط بخش قوس GEO بالای افق (`Elevation >= 0°`) برای ایستگاه فعلی.
  - `Full GEO`: کل بازه `-180° ... +180°`.
- **Scale**:
  - `Equal: 1° X = 1° Y`: نسبت هندسی واقعی زاویه‌ها؛ یک درجه روی محور Longitude و Elevation طول یکسانی روی نمودار دارند.
  - `Auto`: ارتفاع نمودار برای خوانایی مستقل از بازه محور X تنظیم می‌شود.

Tooltip فقط `Satellite Longitude`، `Azimuth` و `Elevation` را نمایش می‌دهد.


## Antenna Beam Calculator (v6)

در انتهای صفحه یک محاسبه‌گر غیرخطی برای Beam آنتن اضافه شده است.

ورودی‌ها:
- موقعیت ایستگاه زمینی از Calculator اصلی
- Longitude ماهواره GEO مرکزی (Boresight)
- حالت محاسبه:
  - Elevation Beamwidth → Required Azimuth Beamwidth
  - Azimuth Beamwidth → Required Elevation Beamwidth
- Beamwidth ورودی

روش محاسبه از تقریب شیب محلی استفاده نمی‌کند. بخش پیوسته‌ی منحنی واقعی GEO که در Beam ورودی قرار می‌گیرد به صورت عددی پیدا می‌شود و سپس Beamwidth متقارن لازم روی محور دیگر محاسبه می‌گردد. محاسبات تا افق هندسی (Elevation >= 0°) محدود می‌شوند.


## Interactive point selection (v7)

- Hover tooltip remains active.
- First click on the GEO curve stores Point 1.
- Second click stores Point 2 and shows signed ΔLongitude, ΔAzimuth and ΔElevation.
- Third click clears the previous pair automatically and becomes the new Point 1.
- The Azimuth delta uses wrapped angular difference in ±180°.
- Negative elevations are not plotted and cannot be selected.


## v8 fix

- Fixed click selection on the SVG chart (v7 accidentally contained Canvas-only drawing calls).
- P1/P2 markers are now native SVG elements.
- Click handling is attached to the chart hit-area and uses SVG viewBox coordinates.
- Negative elevation samples are removed from chart data in both Visible GEO and Full GEO modes.
- Curves are split across invisible gaps so no line is drawn through below-horizon GEO regions.


## v9 — Beam center by Azimuth

در Beam Calculator، ورودی مرکز Beam از Satellite Longitude به **Center Azimuth** تغییر داده شد.

روند محاسبه:
1. Azimuth مرکزی از کاربر دریافت می‌شود.
2. با توجه به Latitude/Longitude/Height ایستگاه، نقطه متناظر روی GEO Arc به‌صورت عددی حل می‌شود.
3. Longitude واقعی ماهواره و Elevation مرکز Beam نمایش داده می‌شوند.
4. محاسبات غیرخطی Beamwidth مانند قبل روی GEO Arc واقعی انجام می‌شوند.

نکته: در عرض جغرافیایی تقریباً صفر، Azimuth به‌تنهایی Longitude ماهواره GEO را یکتا تعیین نمی‌کند و Calculator این حالت را اعلام می‌کند.


## v10 — Presets
۳۱ مرکز استان ایران + چابهار به‌صورت Preset آفلاین اضافه شده‌اند.
