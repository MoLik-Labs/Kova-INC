# Dùng thử giao diện Cloudflare

::: danger Chỉ dùng dữ liệu thử nghiệm
Giao diện này kết nối backend Cloudflare độc lập **đang phát triển**, không phải Kova đầy đủ. Chưa có upload, chia sẻ, phân quyền hoàn chỉnh, đầy đủ driver hay bảo vệ production. Chưa kiểm thử với Google, Dropbox hoặc tài nguyên Cloudflare thật. Không dùng tài khoản hoặc tệp nhạy cảm.
:::

## 1. Xem giao diện trên máy

Cài Node.js và chạy tại thư mục gốc repository:

```sh
npm ci --ignore-scripts
npm ci --ignore-scripts --prefix deploy/cloudflare-worker
deploy/cloudflare-worker/node_modules/.bin/wrangler dev --config deploy/cloudflare-native/wrangler.local.toml --local --ip 127.0.0.1 --port 8787 --var KOVA_NATIVE_TOKEN:local-test-secret-at-least-32-characters
```

Mở `http://127.0.0.1:8787/` trên **chính máy chạy Wrangler**. Đây là cấu hình local với bucket R2 giả lập và token ví dụ công khai. Dừng bằng Ctrl+C. Không deploy file cấu hình local hoặc dùng token mẫu trên Internet. Chế độ này chỉ cho xem giao diện: không có D1, Google OAuth hay phiên người dùng nên đăng nhập chưa hoạt động. Chạy `npm run test:cf-ui` để kiểm tra tự động bằng mô phỏng DOM và kiểm tra asset; mô phỏng không thay thế trình duyệt thật.

## 2. Các thao tác trong bản thử nghiệm

Khi backend thử nghiệm được cấu hình riêng và có tài khoản đã cấp trước, nút đăng nhập Google mở luồng thử nghiệm. Bật `KOVA_EXPERIMENTAL_BROWSER_AUTH=enabled` cùng các flag đăng nhập thử nghiệm: sau callback, trình duyệt quay về giao diện với cookie phiên Secure, HttpOnly. Nhập bearer token thủ công vẫn dành cho thử nghiệm; nếu không bật flag này, callback trả bearer token dạng JSON. **Không gửi token vào chat, URL, log hoặc ảnh chụp màn hình.** Đăng nhập này chưa phù hợp người dùng thật.

Sau đăng nhập, chọn kết nối để duyệt thư mục; nút **Xem thêm** lấy trang tiếp theo. Có thể thử thêm Dropbox bằng access token ngắn hạn của tài khoản thử nghiệm. Nút kết nối Google Drive và Dropbox mở cửa sổ riêng khi các flag OAuth tương ứng được cấu hình; sau khi callback hoàn tất, trở lại trang và bấm **Làm mới**. Chỉ bắt đầu một luồng kết nối cho mỗi nhà cung cấp tại một thời điểm trên cùng trình duyệt. Xóa kết nối chỉ xóa thông tin tại Kova, không tự thu hồi quyền ở Google/Dropbox; hãy thu hồi riêng trong tài khoản nhà cung cấp. Tải tệp qua giao diện thử nghiệm giới hạn 8 MiB; tệp Google Workspace được yêu cầu xuất PDF và có thể không được hỗ trợ cho mọi loại tài liệu.

## 3. Thiết lập backend và kiểm tra an toàn

Để thử nhiều người dùng cần Worker riêng, D1 riêng với migrations, vault key riêng và cấu hình OAuth cùng định danh được cấp trước. Xem `deploy/cloudflare-native/README.md` trong repository và nhánh bạn chọn về bindings, biến, giới hạn và rủi ro. Không trỏ cấu hình thử nghiệm vào Worker hoặc dữ liệu production. Chỉ bật các flag thử nghiệm trong môi trường cô lập; v1 dùng token chung có quyền trên toàn bộ dữ liệu nhà cung cấp và không phải bảo mật đa người dùng.

Trước khi dùng thật vẫn cần hoàn thiện và rà soát bảo mật đăng nhập, bảo vệ chống lạm dụng, phục hồi khóa, phân quyền/chia sẻ, các driver, kiểm thử trình duyệt và kiểm thử tài nguyên thực tế. Nếu giao diện không tải CSS/JS, kiểm tra `GET /`, `/app.css`, `/app.js`, binding `ASSETS`, cấu hình build và CSP; không đăng tải toàn bộ repository.

Để kiểm tra D1 và deploy một Worker thử nghiệm **riêng** sau khi mã có trong fork, xem [hướng dẫn cô lập từng bước](./cloudflare-isolated). Không dùng cấu hình local cho Worker đang chạy.

## WebDAV chỉ đọc thử nghiệm

Worker cô lập có một **phần WebDAV thử nghiệm chỉ đọc R2**, mặc định tắt;
không phải WebDAV đầy đủ hay bản thay thế Kova. Cần bucket R2 thử nghiệm riêng,
prefix giới hạn không rỗng và thông tin Basic riêng. Không đặt `KOVA_NATIVE_TOKEN` khi chỉ thử DAV: API `/v1` cũ dùng token đó có thể đọc toàn bucket, không bị giới hạn bởi prefix DAV. Không thể ghi: không dùng
làm đích backup NodeWarden hoặc kết nối dữ liệu nhạy cảm. Việc tạo R2 có thể cần
xác minh thanh toán tùy tài khoản; đừng thêm thẻ nếu bạn không muốn. Xem
`deploy/cloudflare-native/README.md` trong repository để biết cấu hình, giới
hạn giao thức và kiểm thử cục bộ. Không ghi đè Worker `kova-inc`.

Chỉ thử sau khi mã này đã merge, trên Worker và R2 **mới, riêng**:

1. Tạo bucket thử nghiệm và binding `R2`; không gắn bucket chứa dữ liệu thật.
2. Đặt `KOVA_EXPERIMENTAL_R2_DAV=enabled` và `KOVA_DAV_PREFIX=test-root/` trong cấu hình Worker thử nghiệm. Prefix phải không rỗng, kết thúc bằng `/`, không chứa thành phần `.` hay `..`.
3. Trong mục quản lý secrets của Worker thử nghiệm, đặt `KOVA_DAV_USERNAME` (chữ/số ASCII, dấu `_`, `-` hoặc `.`) và `KOVA_DAV_PASSWORD` ngẫu nhiên dài 32–128 ký tự ASCII in được, không có khoảng trắng. Không ghi bí mật vào repo hoặc gửi trong chat. Tất cả ai có cặp này đều đọc được toàn bộ prefix; không có RBAC, 2FA hay giới hạn lượt.
4. Dùng HTTPS và client WebDAV để thử `PROPFIND` Depth 0/1 và `GET` với file giả. Không bật API bearer `/v1` nếu chỉ thử DAV. Xóa secrets và Worker thử sau khi kết thúc nếu không cần.

Chỉ hỗ trợ `OPTIONS`, `GET`, `HEAD`, `PROPFIND`; không ghi/xóa/khóa,
không hỗ trợ Range hay WebDAV Class 1/2 đầy đủ, không áp dụng quyền theo tài
khoản. PROPFIND trả bộ thuộc tính cố định, không chọn theo body; body tối đa
16 KiB. Thư mục quá giới hạn một trang R2 trả 507 thay vì trả thiếu. Đã thử với
mock và workerd/R2 giả lập, chưa thử client WebDAV hay R2 thật.
