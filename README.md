# AchoVocal

گفتگوی صوتی گروهی P2P با WebRTC، چت متنی و رابط شیشه‌ای. برای Voice هیچ سرویس پولی یا SDK پولی لازم نیست.

## اجرای محلی

```bash
npm install
npm run dev
```

برای اجرای روی یک Node server، حالت in-memory می‌تواند برای تست استفاده شود. اما روی Vercel/serverless باید signaling پایدار فعال باشد؛ چون درخواست‌های API ممکن است روی instanceهای مختلف اجرا شوند.

## Signaling در Production

یک دیتابیس رایگان Upstash Redis بسازید و این دو متغیر را در Environment Variables پروژه قرار دهید:

```env
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

همین متغیرها را برای Preview و Production نیز تنظیم کنید و سپس یک Redeploy انجام دهید.

## Voice

- WebRTC مستقیم بین مرورگرهاست.
- ICE candidateها قبل از آماده شدن remote description در صف نگه داشته می‌شوند.
- فقط یک طرف هر pair initiator است تا offer collision ایجاد نشود.
- در صورت شکست ICE، اتصال دوباره با ICE restart تلاش می‌شود.
- اگر مرورگر autoplay صدای remote را مسدود کند، دکمه فعال‌سازی صدا نمایش داده می‌شود.

هیچ فایل صوتی یا تصویری روی سرور آپلود نمی‌شود؛ سرور فقط signaling و وضعیت اتاق را مدیریت می‌کند.
