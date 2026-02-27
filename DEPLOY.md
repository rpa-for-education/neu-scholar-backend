# Deploy neu-scholar-backend lên Portainer

## Lỗi: `MONGODB_URI is not set in .env`

Khi deploy từ Git, container **không có file .env** — cần cấu hình biến môi trường trong Portainer.

## Cách sửa

### 1. Trong Portainer: Stacks → stack của bạn → Editor

Thêm `environment` vào service `web` (hoặc dùng `portainer-stack.yml`):

```yaml
services:
  web:
    build: .
    ports:
      - "8014:8014"
    restart: unless-stopped
    environment:
      MONGODB_URI: mongodb://user:pass@host:27017
      MONGODB_DB: fitneu
      PORT: "8014"
```

### 2. Hoặc thêm Environment variables trong form Portainer

Khi tạo/sửa stack, mở **Environment variables** và thêm:

| Variable      | Required | Ví dụ                              |
|---------------|----------|------------------------------------|
| `MONGODB_URI` | ✅ Có    | `mongodb://user:pass@host:27017`   |
| `MONGODB_DB`  | Có*      | `fitneu` (default)                 |
| `PORT`        | Không    | `8014`                             |
| `SESSION_SECRET` | Không | Chuỗi bí mật cho session           |

\* Nếu không set `MONGODB_DB` thì mặc định là `fitneu`.

### 3. Deploy với portainer-stack.yml

- Repository: `https://github.com/rpa-for-education/neu-scholar-backend`
- Compose path: `portainer-stack.yml`
- Environment variables (thêm trong form): `MONGODB_URI`, `MONGODB_DB`

---

**Lưu ý:** Đảm bảo server Portainer có thể kết nối tới MongoDB (nếu MongoDB chạy trên máy khác, dùng IP/hostname thay vì `localhost`).
