import type { HelpSlug } from "./index";
import type { HelpDocument } from "./types";

/** The help pages in vi: a page not here shows in English. */
export const helpVi: Partial<Record<HelpSlug, HelpDocument>> = {
  "run-on-your-computer": {
    title: "Chạy agentes.chat trên máy tính của bạn",
    summary:
      "Ứng dụng agentes.chat cũng có thể chạy chính agentes.chat, trên máy Mac, PC hoặc máy Linux, cho bạn hoặc một nhóm nhỏ.",
    sections: [
      {
        id: "download",
        heading: "Tải ứng dụng xuống",
        blocks: [
          "[Tải ứng dụng agentes.chat xuống](/download) cho máy Mac, PC hoặc máy Linux của bạn rồi mở nó lên. Chọn **Trên máy chủ của riêng bạn**, nhấn **Tiếp tục trên máy chủ của tôi**, rồi nhấn **Chạy agentes.chat trên máy tính này**.",
        ],
      },
      {
        id: "how",
        heading: "Cách nó chạy",
        blocks: [
          "Nó chạy bên trong ứng dụng, với cơ sở dữ liệu riêng được tích hợp sẵn, và giữ mọi thứ trong một thư mục trên máy tính này, `.agentes` trong thư mục nhà của bạn. Không cần cài thêm gì khác, không cần Docker, không cần thiết lập cơ sở dữ liệu.",
          "Nó khởi động cùng ứng dụng và dừng khi bạn thoát ứng dụng. Khi thoát, ứng dụng sẽ hỏi trước, vì không ai dùng được agentes.chat cho đến khi ứng dụng mở lại. Muốn dừng nó một lúc mà không thoát ứng dụng, hãy nhấp vào biểu tượng agentes.chat cạnh đồng hồ và chọn **Dừng** trong menu **⋯** của thẻ của nó.",
        ],
      },
      {
        id: "who",
        heading: "Dành cho ai",
        blocks: [
          "Bạn hoặc một nhóm nhỏ. Một chiếc Mac mini, một PC dự phòng hoặc một laptop luôn bật sẽ là nơi ở tốt cho nó, hãy thiết lập như trong [Giữ cho nó luôn bật](#keep-on). Trên máy Mac hoặc PC, ứng dụng là cách chạy agentes.chat mà không cần Docker.",
          "Với nhóm lớn hơn, xem [Chọn cách thiết lập nào](/help/install-on-a-server#choose). Dữ liệu của bạn có thể chuyển sang máy chủ sau này.",
        ],
      },
      {
        id: "keep-on",
        heading: "Giữ cho nó luôn bật",
        blocks: [
          "Trên máy tính mà người khác cũng dùng, hãy thiết lập một lần. **Giữ cho nó luôn chạy**, trong **Tùy chọn › Máy chủ**, cho thấy những gì còn thiếu và mở đúng phần cài đặt cần thiết:",
          {
            list: [
              "**Mở khi đăng nhập** tự bật sau khi thiết lập xong.",
              "Trên máy Mac, bật **Đăng nhập tự động** trong **Cài đặt hệ thống › Người dùng và Nhóm**, để ứng dụng mở sau khi khởi động lại. FileVault sẽ tắt tính năng đăng nhập tự động.",
              "Trên máy Mac, bật **Tự khởi động sau khi mất điện** trong **Cài đặt hệ thống › Năng lượng**.",
              "Máy Mac sẽ không ngủ khi máy chủ đang chạy và **Truy cập được từ điện thoại của bạn và đồng đội** đang bật. Trên Windows và Linux, hãy tắt chế độ ngủ trong phần cài đặt nguồn của hệ thống.",
            ],
          },
        ],
      },
      {
        id: "agents",
        heading: "Các agent của bạn cũng làm việc ở đây",
        blocks: [
          "Các agent của bạn cũng làm việc trên máy tính này, trong các thư mục riêng của chúng, với một trình duyệt, và với Claude Code hoặc Codex khi chúng được cài ở đây.",
          "Agent ở đây chạy với tư cách là bạn. **Các lệnh** được bật theo mặc định, và khi bật, agent của mọi không gian làm việc dùng máy tính này đều có thể truy cập mọi thứ trên đó, kể cả dữ liệu của máy chủ. Tắt chúng trong **Tùy chọn › Công cụ**. Xem [Agent có thể truy cập những gì](/help/computers#reach).",
        ],
      },
      {
        id: "another-workspace",
        heading: "Cho một không gian làm việc khác mượn nữa",
        blocks: [
          "Các không gian làm việc của máy chủ bạn chạy ở đây tự dùng máy tính này. Muốn cho một không gian làm việc ở nơi khác dùng nữa, chẳng hạn một không gian trên agentes.chat Cloud, hãy nhấn **Thêm không gian làm việc…** ở cuối thẻ đầu tiên trong **Tùy chọn › Chung**, hoặc **Thêm máy chủ…** trong **Tùy chọn › Máy chủ**. Đăng nhập vào không gian làm việc đó và nhấn **Cho phép** khi ứng dụng hỏi.",
          "Mỗi không gian làm việc có agent và thư mục riêng ở đây. **Các lệnh** cũng được bật theo mặc định cho không gian đó. Tắt chúng trong câu hỏi của ứng dụng trước khi bạn nhấn **Cho phép**, hoặc sau này trong **Tùy chọn › Công cụ**, nơi mỗi không gian làm việc có công tắc riêng và ứng dụng sẽ hỏi trước khi bật lại một công tắc.",
        ],
      },
      {
        id: "reach",
        heading: "Từ điện thoại của bạn và nhóm của bạn",
        blocks: [
          "**Truy cập được từ điện thoại của bạn và đồng đội** đưa agentes.chat lên Tailscale, một mạng riêng cho các thiết bị của bạn, điện thoại của bạn và những người bạn mời sẽ tham gia mạng đó, và không ai khác truy cập được agentes.chat. Tailscale miễn phí, https://tailscale.com/download. Khi tắt tính năng này, agentes.chat chỉ hoạt động trên máy tính này.",
          "Nếu máy tính này đã chia sẻ thứ khác trên cổng 443 của Tailscale, agentes.chat sẽ dùng 8443, và địa chỉ của nó kết thúc bằng `:8443`.",
        ],
      },
      {
        id: "password",
        heading: "Đăng nhập từ thiết bị khác",
        blocks: [
          "Chủ sở hữu bắt đầu mà không có mật khẩu, ứng dụng đăng nhập cho bạn trên máy tính này. Muốn đăng nhập từ trình duyệt trên máy tính khác, hãy thêm mật khẩu trong **Cài đặt › Tài khoản của bạn**. Trước khi bạn làm vậy, **Tùy chọn › Máy chủ** sẽ cho biết điều đó, và **Thêm mật khẩu** sẽ mở trang đó. Ứng dụng điện thoại kết nối bằng cách quét mã QR dưới mục **Trên điện thoại của bạn**, trong **Tùy chọn › Máy chủ**. Mã QR cần **Truy cập được từ điện thoại của bạn và đồng đội** đang bật.",
          "Khi chủ sở hữu xóa tài khoản của mình, trong **Cài đặt › Tài khoản của bạn**, tài khoản sẽ mất hẳn sau 7 ngày, và các không gian làm việc chỉ có mình họ ở trong cũng mất theo. Trước lúc đó, hãy đăng nhập và nhấn **Khôi phục tài khoản** để lấy lại. Khi tài khoản đã mất, nếu không còn tài khoản nào, ứng dụng sẽ mở cửa sổ chào mừng để tạo chủ sở hữu mới. Nếu người khác vẫn còn tài khoản, mỗi người đăng nhập bằng email của riêng mình.",
        ],
      },
      {
        id: "updates",
        heading: "Cập nhật",
        blocks: [
          "Ứng dụng tự tìm bản cập nhật. Khi **Tự cài đặt bản cập nhật vào ban đêm** đang bật, trong **Tùy chọn › Cập nhật**, ứng dụng cài chúng trong khoảng 3:00 đến 5:00 khi ứng dụng đang mở. Tính năng này bật theo mặc định khi máy chủ chạy ở đây. Nếu không, hãy nhấn **Cập nhật và mở lại**. Máy chủ và mọi agent khởi động lại cùng nó. Cơ sở dữ liệu được sao chép trước, và nếu phiên bản mới không phản hồi trong vòng 3 phút, ứng dụng tự quay lại phiên bản trước cùng dữ liệu của nó.",
        ],
      },
      {
        id: "backups",
        heading: "Sao lưu",
        blocks: [
          "Khi **Sao lưu mỗi đêm** đang bật (ứng dụng 0.8.1 trở lên), trong **Tùy chọn › Máy chủ**, ứng dụng lưu cơ sở dữ liệu, các tệp và `.env` vào `.agentes/backups`, trong thư mục nhà của bạn, mỗi đêm lúc 3:00. Máy tính đang ngủ vào lúc đó sẽ sao lưu khi tỉnh dậy. **Sao lưu ngay** cũng làm vậy ngay lập tức. Mỗi lần sao lưu dừng máy chủ trong chốc lát, và hai bản mới nhất được giữ lại.",
          "**Sao chép tới** cũng đặt mỗi bản sao lưu mới vào một thư mục bạn chọn, như ổ USB hoặc iCloud Drive, nơi hai bản mới nhất được giữ lại. Chúng chứa các khóa của bạn, hãy giữ chúng riêng tư. **Khôi phục…** đưa agentes.chat trở lại một bản sao lưu, gồm tin nhắn, tệp và cài đặt. Nó dừng khoảng một phút, và những gì có trước đó được giữ trong thư mục sao lưu.",
        ],
      },
      {
        id: "uninstall",
        heading: "Bắt đầu lại hoặc gỡ cài đặt",
        blocks: [
          "Mọi thứ agentes.chat giữ trên máy tính này đều nằm trong các thư mục trong thư mục nhà của bạn, không nằm bên trong ứng dụng. Vì vậy, chuyển ứng dụng vào Thùng rác không xóa gì cả, và cũng không dừng agentes.chat nếu nó đang chạy.",
          "Muốn bắt đầu lại, hãy nhấn **Xóa và bắt đầu lại…** trong **Tùy chọn › Máy chủ**. Nó dừng agentes.chat ở đây và chuyển mọi thứ nó giữ sang một thư mục mới trong thư mục nhà của bạn, có tên `agentes.chat erased` kèm ngày hôm đó, và ở đó cho đến khi bạn xóa. Những gì agent của nó giữ trên máy tính này, như trình duyệt và thông tin đăng nhập của chúng, sẽ bị xóa khỏi `.agentes-runner`. Các không gian làm việc của nó mất đi đối với mọi người dùng chúng. Sau đó cửa sổ chào mừng mở ra, và bạn thiết lập lại với một tài khoản chủ sở hữu mới. Các tệp của agent, trong `agentes` trong thư mục nhà của bạn, vẫn ở nguyên chỗ.",
          "Muốn mang nó trở lại sau này, hãy thoát ứng dụng, chuyển một thư mục `.agentes` mới hơn sang chỗ khác nếu có, đổi tên thư mục `agentes.chat erased` thành `.agentes`, rồi mở ứng dụng và thiết lập lại trên máy tính này. Nó khởi động với các không gian làm việc và chủ sở hữu như trước. Những gì agent của nó giữ trên máy tính này không quay lại, nên chúng cần đăng nhập lại.",
          "Muốn gỡ agentes.chat khỏi máy tính này hoàn toàn:",
          {
            list: [
              "Tắt **Mở khi đăng nhập** trong **Tùy chọn › Chung**.",
              "Thoát ứng dụng. Đóng cửa sổ của nó là chưa đủ. Trên máy Mac, nhấp vào biểu tượng của nó trong Dock, rồi chọn **Thoát agentes.chat** trong menu agentes.chat ở đầu màn hình, hoặc nhấn ⌘Q. Trên Windows và Linux, nhấp vào biểu tượng agentes.chat cạnh đồng hồ và chọn **Thoát agentes.chat**. Nếu nó hỏi **Thoát agentes.chat?**, hãy nhấn **Thoát**.",
              "Xóa ứng dụng. Trên máy Mac, chuyển nó vào Thùng rác. Trên Windows và Linux, gỡ cài đặt nó như mọi ứng dụng khác.",
              "Xóa các thư mục này trong thư mục nhà của bạn. Chúng chứa dữ liệu của bạn, và khi đã xóa thì không lấy lại được, nên hãy giữ một bản sao lưu ở nơi khác trước nếu bạn có thể cần đến, `.agentes` (tin nhắn, tệp, tài khoản, cài đặt và bản sao lưu), mọi thư mục `agentes.chat erased`, `.agentes-runner` (những gì agent giữ trên máy tính này, như trình duyệt và thông tin đăng nhập của chúng) và `agentes` (các tệp của agent). Thư mục có tên bắt đầu bằng dấu chấm là thư mục ẩn. Trên máy Mac, mở thư mục nhà của bạn trong Finder và nhấn ⇧⌘. (phím Shift, Command và dấu chấm) để hiện chúng.",
              "Xóa các thư mục riêng của ứng dụng. Chúng chỉ chứa cài đặt của nó, thông tin đăng nhập trong cửa sổ của nó và nhật ký của nó. Trên máy Mac, mọi thứ có tên bắt đầu bằng `chat.agentes.desktop` trong các thư mục Application Support, Caches, HTTPStorages, Logs, Preferences và WebKit của `~/Library`, và `agentes.chat.plist` trong `~/Library/LaunchAgents`. Trên Windows, `%APPDATA%\\chat.agentes.desktop` và `%LOCALAPPDATA%\\chat.agentes.desktop`. Trên Linux, `~/.config/chat.agentes.desktop` và `~/.local/share/chat.agentes.desktop`. Trên máy Mac, muốn mở một trong các thư mục này, hãy nhấn ⇧⌘G trong Finder và nhập đường dẫn của nó, chẳng hạn `~/Library/Caches`.",
            ],
          },
        ],
      },
      {
        id: "ai-programs",
        heading: "Claude Code và Codex",
        blocks: [
          "Ứng dụng tìm Claude Code và Codex qua `PATH` của shell đăng nhập của bạn, cùng các thư mục thường gặp như `~/.local/bin`, `/opt/homebrew/bin` và `/usr/local/bin`. Nếu **Tùy chọn › Công cụ** cho biết **Không tìm thấy**, nó sẽ hiện dòng lệnh cài đặt nó. Chạy dòng đó trong Terminal, rồi nhấn **Kiểm tra lại**.",
        ],
      },
      {
        id: "moving",
        heading: "Chuyển sang máy chủ",
        blocks: [
          {
            list: ["Thoát ứng dụng, rồi xuất cơ sở dữ liệu bằng bản sao máy chủ của chính ứng dụng. Trên máy Mac:"],
          },
          {
            code: "BUN_BE_BUN=1 /Applications/agentes.chat.app/Contents/MacOS/agentes-runner \\\n  ~/.agentes/app/current/server/native.js db dump --data ~/.agentes --out agentes.sql",
          },
          {
            list: [
              "[Cài agentes.chat trên máy chủ](/help/install-on-a-server), nhưng chưa khởi động nó. Trong `.env` của nó, đặt `AGENTES_SECRET` từ `~/.agentes/.env`, rồi chỉ khởi động cơ sở dữ liệu, `docker compose up -d postgres`.",
              "Nạp bản xuất vào, `docker compose exec -T postgres psql -U agentes -d agentes -v ON_ERROR_STOP=1 < agentes.sql`.",
              "Khởi động nó bằng `docker compose up -d`, sao chép `~/.agentes/files` vào đó như hướng dẫn đầy đủ chỉ rõ, và đăng nhập như trước.",
            ],
          },
        ],
      },
    ],
  },
  "workspace-computer": {
    title: "Máy tính của không gian làm việc",
    summary: "Mỗi không gian làm việc có một máy tính riêng, luôn bật, nơi các agent của nó làm việc.",
    sections: [
      {
        id: "what",
        heading: "Nó là gì",
        blocks: [
          "Một máy tính chỉ dành cho không gian làm việc này, luôn bật. Mỗi agent có người dùng riêng trên đó, với thư mục, màn hình, trình duyệt và tệp riêng. Từ trang của một agent, bạn có thể xem nó làm việc, và nắm quyền điều khiển khi cần.",
        ],
      },
      {
        id: "own",
        heading: "Máy tính và điện thoại của riêng bạn",
        blocks: [
          "Agent cũng có thể làm việc trên máy tính và điện thoại bạn mang đến, một máy Mac hoặc PC có ứng dụng agentes.chat, một máy chủ, một điện thoại Android hoặc một iPhone. Xem [Máy tính và điện thoại bạn mang đến](/help/computers).",
        ],
      },
      {
        id: "plans",
        heading: "Các gói AI của bạn",
        blocks: [
          "Các agent của bạn có thể suy nghĩ bằng gói AI của riêng bạn, như Claude, ChatGPT, GLM hoặc Kimi, đã đăng nhập trên máy tính này, không cần khóa API. Tài khoản ở lại trên máy tính này, và agentes.chat không bao giờ thấy mật khẩu hay quyền truy cập.",
          "Các gói AI Pro và Ultra của Google không hoạt động ở đây, điều khoản của Google không cho phép dùng chúng trong sản phẩm khác. Khóa API của Gemini thì được.",
        ],
      },
      {
        id: "size",
        heading: "Kích thước của nó",
        blocks: ["CPU, bộ nhớ và ổ đĩa của nó hiện trong **Cài đặt › Thiết bị**."],
      },
      {
        id: "trouble",
        heading: "Nếu nó ngừng phản hồi",
        blocks: ["Nó thường quay lại trong vài phút, và chúng tôi đang xử lý, bạn không cần làm gì cả."],
      },
    ],
  },
  computers: {
    title: "Máy tính và điện thoại của bạn",
    summary:
      "Mang đến một máy Mac, một PC, một máy Linux, một máy chủ hoặc một điện thoại, và các agent của bạn sẽ làm việc trên đó. Trên agentes.chat Cloud và trên máy chủ của riêng bạn đều như nhau.",
    sections: [
      {
        id: "app",
        heading: "Từ ứng dụng agentes.chat",
        blocks: [
          "Cài ứng dụng trên máy tính, mở nó và đăng nhập vào không gian làm việc của bạn. Nó hỏi **Cho agent của <workspace> dùng máy Mac này?** (máy PC này trên Windows, máy tính này trên Linux). Chọn ai có thể dùng nó và nhấn **Cho phép**. Chỉ vậy thôi.",
          "Đã đăng nhập rồi? Mở **Tùy chọn › Chung** và nhấn **Cho phép** ở hàng của không gian làm việc trong thẻ đầu tiên. Không thấy ở đó? Nhấn **Thêm không gian làm việc…** ở cuối thẻ đó và đăng nhập.",
        ],
      },
      {
        id: "web",
        heading: "Từ trang web",
        blocks: [
          "Trong **Cài đặt › Thiết bị**, nhấn **Kết nối thiết bị**:",
          {
            list: [
              "**Máy Mac này** hoặc **PC này**, mở ứng dụng, và ứng dụng hỏi bạn trước.",
              "**Một máy tính khác**, cài ứng dụng ở đó, đăng nhập bằng chính bạn và nhấn **Cho phép**. Nó tự hiện ở đây.",
              "**Một máy chủ hoặc VPS**, chạy một dòng lệnh trong terminal của nó, rồi cho nó tham gia. Dòng lệnh dùng được một lần, trong 10 phút.",
            ],
          },
          "Ứng dụng chỉ kết nối bằng một lần nhấp tới một địa chỉ có https, như địa chỉ Tailscale kết thúc bằng `.ts.net`. Với địa chỉ http thường, hãy dùng dòng lệnh trong terminal.",
        ],
      },
      {
        id: "phones",
        heading: "Điện thoại",
        blocks: [
          "Điện thoại Android kết nối qua bất kỳ máy tính nào đã kết nối, bằng cáp, hoặc qua Wi-Fi trên Android 14 trở lên với bản cập nhật bảo mật tháng 5 năm 2026. iPhone kết nối qua máy Mac có ứng dụng và Xcode, và ứng dụng thiết lập phần còn lại. Cả hai đều bắt đầu từ **Kết nối thiết bị**.",
        ],
      },
      {
        id: "who",
        heading: "Ai có thể dùng nó",
        blocks: [
          "Thiết bị mới chỉ dành cho mình bạn, **Chỉ mình tôi** nghĩa là bạn và các agent làm việc cho bạn. Mở nó cho mọi người trong không gian làm việc, hoặc cho một số người và vai trò, khi bạn cho phép hoặc sau này trên trang của nó trong **Cài đặt › Thiết bị**.",
        ],
      },
      {
        id: "open",
        heading: "Khi ứng dụng đang mở",
        blocks: [
          "Agent chỉ làm việc trên một máy tính khi ứng dụng chạy ở đó và máy tính đang thức. Khi ứng dụng hỏi, hãy để **Giữ sẵn sàng, mở agentes.chat khi đăng nhập** được chọn. Máy tính đã tắt hoặc đang ngủ sẽ hiện **Ngoại tuyến**, và agent chờ nó quay lại.",
        ],
      },
      {
        id: "pausing",
        heading: "Tạm dừng và ngắt kết nối",
        blocks: [
          "Trên máy tính, biểu tượng agentes.chat cạnh đồng hồ tạm dừng agent của mọi không gian làm việc, hoặc chỉ của một không gian. Trong **Tùy chọn › Chung**, công tắc của mỗi không gian làm việc chỉ tạm dừng không gian đó, và **Rời đi**, trong menu **⋯** của nó, ngắt kết nối nó. Không có gì mới bắt đầu khi đang tạm dừng, và những gì đang chạy sẽ chạy xong. Ngắt kết nối giữ các thư mục của agent trên ổ đĩa.",
          "Từ trang web, **Xóa** trên trang của thiết bị sẽ ngắt kết nối nó.",
        ],
      },
      {
        id: "organizations",
        heading: "Nhiều không gian làm việc, một máy tính",
        blocks: [
          "Đăng nhập vào từng không gian làm việc trong cùng một ứng dụng và nhấn **Cho phép** cho từng cái. Các không gian làm việc trên agentes.chat Cloud và trên máy chủ của riêng bạn có thể dùng chung một máy tính (ứng dụng 0.6.1 trở lên). Mỗi cái có agent và thư mục riêng ở đó, và ngắt kết nối một cái không ảnh hưởng các cái còn lại.",
          "Máy chủ mà ứng dụng chạy trên máy tính này đã được kết nối sẵn và không cần gì thêm. Muốn cho máy tính đó mượn thêm cho một không gian làm việc ở nơi khác, xem [Cho một không gian làm việc khác mượn nữa](/help/run-on-your-computer#another-workspace).",
          "Dùng ứng dụng trên laptop chỉ như một cửa sổ nhìn vào không gian làm việc của bạn? Khi nó hỏi có cho agent dùng laptop hay không, **Để sau** giữ nó là một cửa sổ bình thường.",
          "Máy chủ kết nối bằng dòng lệnh trong terminal chỉ hoạt động cho một không gian làm việc. Kết nối nó từ một không gian làm việc khác sẽ chuyển máy chủ sang không gian đó, và không gian đầu tiên không còn truy cập được nó. Muốn nhiều không gian làm việc trên một máy tính, hãy dùng ứng dụng.",
        ],
      },
      {
        id: "line",
        heading: "Khi agent phải xếp hàng chờ",
        blocks: [
          "Mỗi phần việc của một agent dùng bộ nhớ của máy tính. Khi bộ nhớ trống sắp hết, phần việc tiếp theo xếp hàng chờ cho đến khi một phần khác kết thúc. Con người được ưu tiên trước. Số CPU không thay đổi điều này.",
          "Máy tính có 4 GB bộ nhớ chạy hai hoặc ba việc cùng lúc, máy có 8 GB chạy khoảng chín việc. Máy Mac hoặc PC chạy tối đa tám việc. Trình duyệt và màn hình nền mà agent giữ mở cũng dùng bộ nhớ. Muốn hàng chờ ngắn hơn, hãy dùng máy tính có nhiều bộ nhớ hơn, hoặc kết nối thêm một máy nữa và chia agent giữa chúng trong **Cài đặt › Thiết bị**. Các không gian làm việc dùng chung một máy tính thì dùng chung bộ nhớ của nó.",
        ],
      },
      {
        id: "folders",
        heading: "Thư mục",
        blocks: [
          "Mỗi agent luôn có thư mục riêng, trong `~/agentes/<workspace>`. Nhiều thư mục hơn được cho phép trên chính máy tính, không bao giờ từ trang web, trong ứng dụng, **Tùy chọn › Thư mục**, hoặc bằng `agentes-runner folders allow` trên máy chủ. Mỗi không gian làm việc cho phép các thư mục của riêng nó, những gì bạn cho phép cho một cái chỉ tính cho agent của nó. Xóa một thư mục không xóa gì cả. Nó chỉ lấy đi quyền truy cập.",
        ],
      },
      {
        id: "reach",
        heading: "Agent có thể truy cập những gì",
        blocks: [
          "Agent chạy với tư cách là bạn, người dùng của máy tính. Công cụ tệp của chúng ở trong các thư mục của chúng, nhưng một lệnh có thể đọc mọi thứ bạn đọc được:",
          {
            list: [
              "các tệp và thông tin đăng nhập của bạn",
              "thư mục của các agent khác, kể cả của các không gian làm việc khác, và thông tin đăng nhập mà trình duyệt của chúng giữ",
              "token kết nối máy tính này",
              "trên máy tính cũng chạy agentes.chat, cơ sở dữ liệu và các khóa của nó trong `.agentes`",
            ],
          },
          "agentes.chat từ chối các lệnh nêu tên khóa, token và thông tin đăng nhập của nó, nhưng đó là một quy tắc, không phải một bức tường. **Các lệnh** được bật theo mặc định. Tắt chúng trong câu hỏi của ứng dụng trước khi bạn nhấn **Cho phép**, hoặc sau này trong **Tùy chọn › Công cụ**, nơi mỗi không gian làm việc có công tắc riêng (ứng dụng 0.8.1 trở lên) và ứng dụng hỏi trước khi bật lại một công tắc. Claude Code và Codex chạy lệnh riêng của chúng trong thư mục của agent, theo quy tắc riêng của chúng, ngay cả khi Các lệnh đã tắt.",
          "Muốn có một bức tường thật sự, hãy dùng máy chủ Linux. Trên Debian 13, cài bằng `--system`, mỗi agent là một người dùng riêng. Trên Ubuntu, các agent dùng chung một người dùng, `agentes`, chúng thấy thư mục của nhau, không thấy của bạn hay của máy chủ. Hoặc cho agent một máy tính riêng của chúng.",
        ],
      },
    ],
  },
  import: {
    title: "Mang agent của bạn đến",
    summary:
      "Mang agent từ một ứng dụng khác, hoặc từ một không gian làm việc agentes.chat khác, cùng chỉ dẫn, skill, quy trình định kỳ và bộ nhớ của chúng.",
    sections: [
      {
        id: "comes",
        heading: "Những gì đi cùng",
        blocks: [
          {
            list: [
              "Các agent, với tên, vai trò, chỉ dẫn và diện mạo của chúng.",
              "Các skill, được bật cho những agent đã có chúng.",
              "Các kênh công khai, với các agent ở trong đó.",
              "Các quy trình định kỳ, đang hoạt động và theo lịch của chúng. Tạm dừng chúng trong **Các quy trình định kỳ** nếu bạn muốn.",
              "Bộ nhớ, những gì mỗi agent ghi nhớ.",
              "Tệp riêng của mỗi agent (thư mục tệp của OpenBot.run, một không gian làm việc OpenClaw), trong một thư mục mang tên nó trong **Drive**. Khóa, thông tin đăng nhập và tệp hệ thống ở lại phía sau, và không có gì đã ở đó bị thay thế.",
            ],
          },
        ],
      },
      {
        id: "never",
        heading: "Những gì không bao giờ đi cùng",
        blocks: [
          "Khóa, mật khẩu, thông tin đăng nhập và lịch sử trò chuyện không bao giờ đi cùng, các agent suy nghĩ bằng AI của không gian làm việc. Một số thứ chưa có tương đương ở đây, hoặc không bao giờ nên di chuyển trong một tệp. Bạn có thể tạo lại chúng sau.",
          "Tệp và thư mục được đọc trong trình duyệt của bạn. Liên kết GitHub đi qua máy chủ của không gian làm việc. Tệp khóa và tệp đăng nhập không bao giờ được mở, và không có gì thay đổi cho đến khi bạn xác nhận.",
        ],
      },
      {
        id: "mcp",
        heading: "Kết nối bằng MCP",
        blocks: [
          "MCP cho phép ứng dụng AI của bạn truy cập không gian làm việc này, để nó tự tạo các agent ở đây, cùng chỉ dẫn, skill và quy trình định kỳ của chúng. Chọn ứng dụng của bạn, chọn **Kết nối bằng MCP**, rồi:",
          {
            list: [
              "Kết nối địa chỉ mà bước này hiện, theo các bước riêng của ứng dụng đó. [Cách kết nối, theo từng ứng dụng](/help/apps-de-ia#connect)",
              "Trên trang đăng nhập, chọn **Tạo và sửa agent, quy trình định kỳ và skill**.",
              "Dán yêu cầu vào ứng dụng. Các agent hiện trên bước này khi chúng đến.",
            ],
          },
          "Khi một ứng dụng không kết nối được, hãy chọn **Từ một tệp** hoặc **Chỉ dùng prompt**, tùy bước này hiện gì. [Từ một ứng dụng khác](/help/import#other-apps) nói về yêu cầu đó.",
        ],
      },
      {
        id: "other-apps",
        heading: "Từ một ứng dụng khác",
        blocks: [
          "Chọn **Grok Bot**, **ChatGPT dots** hoặc **Ứng dụng khác**. Sao chép yêu cầu, dán nó vào ứng dụng đó, rồi mang về những gì nó trả lại, thả tệp vào, hoặc dán toàn bộ câu trả lời. Mỗi ứng dụng đặt nó ở đâu:",
          {
            list: [
              "**Grok Bot**, trong cuộc trò chuyện với bot của bạn. Nó trả lời bằng JSON, hãy sao chép toàn bộ câu trả lời.",
              "**ChatGPT dots**, trong một cuộc trò chuyện mới. Tải tệp nó tạo xuống.",
              "**Claude**, trong một cuộc trò chuyện mới, hoặc trong dự án của các agent của bạn. Tải tệp nó tạo xuống.",
              "**Manus**, trong một tác vụ mới. Tệp nằm trong kết quả của tác vụ.",
              "**Rakazo**, gửi nó cho agent của bạn. Nó trả lời bằng JSON, hãy sao chép toàn bộ câu trả lời.",
              "**OpenBot**, không cần yêu cầu. Kéo thư mục tenant (agents.yaml, agents/, model.yaml, skills.yaml) hoặc dán liên kết GitHub của nó.",
            ],
          },
        ],
      },
      {
        id: "export",
        heading: "Xuất một không gian làm việc",
        blocks: [
          "**Cài đặt › Nhập và xuất › Xuất** tải xuống một tệp .json, để mang agent của bạn sang không gian làm việc khác hoặc giữ một bản sao. Trong tệp có:",
          {
            list: [
              "Các agent, với chỉ dẫn, mô hình và diện mạo của chúng",
              "Các skill, với toàn bộ SKILL.md",
              "Các kênh công khai, với các agent của chúng",
              "Các quy trình định kỳ đã lên lịch (chúng đến nơi trong trạng thái đang hoạt động)",
              "Bộ nhớ mà mọi người trong không gian làm việc đều thấy được",
            ],
          },
          "Không bao giờ có trong đó:",
          {
            list: [
              "Khóa API và mật khẩu",
              "Trình kết nối và thông tin đăng nhập",
              "Máy tính",
              "Cuộc trò chuyện, tin nhắn và kênh riêng tư",
              "Mức sử dụng, chi phí và lịch sử hoạt động",
            ],
          },
          "Muốn dùng tệp này, hãy mở **Cài đặt › Nhập và xuất** trong không gian làm việc kia và thả tệp .json vào.",
        ],
      },
    ],
  },
  wiki: {
    title: "Wiki",
    summary: "Những gì công ty biết, trong các trang liên kết với nhau.",
    sections: [
      {
        id: "links",
        heading: "Liên kết",
        blocks: [
          "Gõ [[ để liên kết một trang khác. Liên kết ngược và đồ thị cho thấy các trang kết nối với nhau thế nào.",
        ],
      },
      {
        id: "agents",
        heading: "Agent dùng nó thế nào",
        blocks: ["Agent đọc wiki khi chúng trả lời. Chúng chỉ viết vào đó khi có người yêu cầu."],
      },
      {
        id: "obsidian",
        heading: "Mang một vault Obsidian đến",
        blocks: [
          "Thả thư mục của vault, hoặc một tệp .zip của nó, vào bước Ngữ cảnh của phần thiết lập hoặc vào phần nhập riêng của wiki. [[Links]], [[note|alias]] và [[note#section]] vẫn hoạt động. Thẻ đến từ frontmatter và nội dung. Tệp đính kèm đi vào Drive, và hình ảnh cùng tệp nhúng trở thành thẻ trên trang. Callout vẫn là callout. Truy vấn Dataview đến dưới dạng văn bản, hãy nhờ một agent dựng bảng. Canvas và cài đặt của Obsidian (.obsidian) ở lại bên ngoài.",
        ],
      },
    ],
  },
  memory: {
    title: "Bộ nhớ",
    summary: "Những gì mỗi agent học được từ các cuộc trò chuyện và sự sửa chữa của nhóm.",
    sections: [
      {
        id: "learns",
        heading: "Agent học thế nào",
        blocks: [
          "Agent học từ các cuộc trò chuyện và từ sự sửa chữa của nhóm. Những gì một agent biết sẽ vào ngữ cảnh của nó khi liên quan. Trên tab **Bộ nhớ** của nó, hãy sửa, ghim hoặc lưu trữ những gì sai hoặc đã cũ.",
        ],
      },
      {
        id: "permissions",
        heading: "Bộ nhớ không cấp thêm quyền nào",
        blocks: [
          "Không có gì trong bộ nhớ cho phép một agent làm được nhiều hơn. Những gì nó làm được nằm trong **Công cụ và quyền truy cập** của nó.",
        ],
      },
      {
        id: "proposals",
        heading: "Thay đổi được đề xuất",
        blocks: [
          "Khi một bài học lặp lại, agent có thể đề xuất thay đổi chỉ dẫn của chính nó hoặc ngữ cảnh của không gian làm việc. Phần duyệt của agent áp dụng nó nếu hợp lý, viết thành một quy tắc ngắn, hoặc bỏ qua và nói lý do. Mọi thay đổi hiện trong Đề xuất cải tiến của agent, nơi bạn có thể hoàn tác nó. Thay đổi đã hoàn tác được giữ lại như một bài học, để agent không mắc lại.",
        ],
      },
    ],
  },
  approvals: {
    title: "Phê duyệt",
    summary: "Các hành động nhạy cảm chờ một người, một lần hoặc mãi mãi.",
    sections: [
      {
        id: "what",
        heading: "Những gì hỏi trước",
        blocks: [
          "Khi một agent muốn hợp nhất, triển khai, khôi phục, gửi thứ gì đó ra ngoài hoặc xóa dữ liệu, nó hỏi trước. Đó là **Chỉ những gì rủi ro**, mức mà mọi agent bắt đầu. Trên trang của agent, dưới **Phê duyệt**, **Luôn hỏi** khiến nó hỏi trước khi thay đổi bất cứ điều gì, và **Không bao giờ hỏi** khiến nó không hỏi gì cả, kể cả hợp nhất, triển khai, thanh toán và quy trình định kỳ. Yêu cầu hiện trong **Phê duyệt** và trong cuộc trò chuyện, với hành động chính xác và lý do.",
        ],
      },
      {
        id: "always",
        heading: "Một lần, hoặc luôn luôn",
        blocks: [
          "Phê duyệt bao gồm một hành động chính xác, với các giá trị của nó. Nếu agent thay đổi bất cứ điều gì, nó hỏi lại.",
          "**Luôn phê duyệt** cho phép agent làm loại hành động đó từ nay, với bất kỳ giá trị nào, mà không hỏi. Trên yêu cầu của một quy trình định kỳ, **Luôn áp dụng trong quy trình định kỳ này** cũng làm vậy chỉ cho quy trình đó. **Luôn phê duyệt** có cho mọi loại hành động, kể cả hợp nhất và triển khai, khi agent ở mức **Chỉ những gì rủi ro**. **Luôn áp dụng trong quy trình định kỳ này** không được đưa ra cho hợp nhất, triển khai, khôi phục và những việc tương tự. Muốn hoàn tác, hãy vào **Công cụ và quyền truy cập** trên trang của agent, hoặc vào cài đặt của quy trình định kỳ.",
        ],
      },
      {
        id: "who",
        heading: "Ai phê duyệt",
        blocks: [
          {
            list: [
              "Chủ sở hữu của agent, cho các yêu cầu của nó.",
              "Bất kỳ ai có vai trò với **Phê duyệt hành động của agent**, cho mọi agent.",
              "Những người mà một agent nêu tên khi nó hỏi, thay cho chủ sở hữu của nó.",
              "Người thay thế cho ai đó trong **Ai phê duyệt thay tôi**, cho những gì được hỏi người đó. Hợp nhất, triển khai và các hành động rủi ro khác chỉ khi tính năng đó đang bật.",
            ],
          },
          "Một hành động trong hộp thư của chính ai đó chờ riêng người đó. Quyền truy cập mới cho một agent chờ những người quản lý agent.",
          "Lodi, cánh tay phải của bạn, cũng có thể phê duyệt thay bạn các agent mới mà agent khác đề xuất và các thay đổi về mô hình, ngân sách và kênh của một agent, chỉ khi bạn đã yêu cầu chúng. Ai thay thế cho bạn và Lodi phê duyệt những gì được chọn trong **Cài đặt › Bạn › Phê duyệt**.",
        ],
      },
      {
        id: "refusing",
        heading: "Từ chối",
        blocks: ["Nói lý do, nếu bạn muốn, agent đọc nó, điều chỉnh kế hoạch của nó và giữ nó như một bài học."],
      },
      {
        id: "meetings",
        heading: "Cuộc họp",
        blocks: ["Agent chỉ gợi ý thời gian. Lời mời gửi cho mọi người luôn đi qua người đã yêu cầu."],
      },
    ],
  },
  "who-answers": {
    title: "Ai trả lời một tin nhắn",
    summary: "Việc nhắc đến chọn ra agent. Khi không có, agentes.chat chọn thay bạn, theo thứ tự này.",
    sections: [
      {
        id: "order",
        heading: "Tin nhắn tìm agent của nó thế nào",
        blocks: [
          "Tin nhắn @nhắc đến một agent sẽ đến agent đó. Tin nhắn không nhắc đến ai được đọc bởi lựa chọn đầu tiên trong số này mà không gian làm việc có:",
          {
            list: [
              "**Jev**, một mô hình nhỏ, nhanh, được làm cho những quyết định như thế này.",
              "**Một mô hình nhỏ trên một trong các khóa API của không gian làm việc**, như Claude Haiku 5.5 hoặc GPT-6 Luna.",
              "**Gói Claude hoặc ChatGPT của riêng bạn**, cho các tin nhắn bạn viết, trên máy chủ bạn tự chạy. Nó đọc chúng trên máy tính nơi nó đã đăng nhập, và mất vài giây.",
              "**Quy tắc đơn giản**, câu trả lời cho một agent sẽ đến nó, và tin nhắn tiếp nối ngay sau khi bạn nói chuyện với nó cũng vậy, hoặc tin nhắn trong một kênh nơi bạn ở một mình với một agent.",
            ],
          },
          "Khi không lựa chọn nào trong số này phù hợp, không agent nào trả lời. Hãy nhắc đến một agent để gọi nó.",
        ],
      },
      {
        id: "jev",
        heading: "Jev",
        blocks: [
          "Khi agentes.chat lưu trữ không gian làm việc của bạn, Jev đã bao gồm sẵn. Trên máy chủ bạn tự chạy, nó dùng khóa TypeSafe hoặc OpenRouter của chủ sở hữu, khoảng US$ 0.0001 mỗi tin nhắn, [Thiết lập Jev](/help/jev#setup).",
        ],
      },
      {
        id: "plans",
        heading: "Vì sao gói của bạn chỉ chọn cho tin nhắn của bạn",
        blocks: ["Các gói Claude và ChatGPT là cá nhân, nên gói của bạn chỉ chọn cho các tin nhắn bạn viết."],
      },
      {
        id: "see",
        heading: "Xem ai đã chọn",
        blocks: ["Mở dấu kiểm dưới một tin nhắn. Dòng cuối của nó cho biết ai đã chọn các agent."],
      },
    ],
  },
  jev: {
    title: "Jev",
    summary:
      "Một mô hình nhanh của TypeSafe đưa ra quyết định nhanh cho các agent của bạn. Trên máy chủ của riêng bạn, nó là tùy chọn, với một khóa của riêng bạn.",
    sections: [
      {
        id: "what",
        heading: "Nó làm gì",
        blocks: [
          {
            list: [
              "**Chọn ai trả lời.** Tin nhắn không ai @nhắc đến sẽ đến đúng agent trong chưa đầy một giây, ngay cả khi agent của bạn suy nghĩ bằng một gói và bạn không có khóa API.",
              "**Giữ bộ nhớ gọn gàng.** Nó phát hiện một điều lặp lại hoặc một sự thật mới hơn ngay cả khi diễn đạt bằng từ khác, điều lặp lại hợp nhất với những gì agent đã biết, và sự thật mới hơn thay thế sự thật cũ. Mỗi ngày một lần, nó dọn dẹp phần còn lại.",
              "**Nhìn thấy màn hình.** Trên trình duyệt và màn hình nền của chúng, agent tìm nút và trường từ một mô tả, nhìn kỹ hơn những cái nhỏ, và kiểm tra trên hình ảnh của màn hình rằng một bước đã thành công.",
              "**Đọc ít hơn.** Mỗi lượt chỉ nạp những công cụ agent có khả năng cần, nên AI của bạn đọc ít hơn và tốn ít hơn.",
            ],
          },
        ],
      },
      {
        id: "without",
        heading: "Khi không có nó",
        blocks: [
          "Mọi thứ vẫn hoạt động, chậm hơn và ít cẩn thận hơn.",
          {
            list: [
              "**Ai trả lời**, một mô hình nhỏ trên một trong các khóa API của bạn sẽ chọn, như Claude Haiku 5.5 hoặc GPT-6 Luna. Khi không có khóa, gói Claude hoặc ChatGPT của riêng mỗi người chọn cho các tin nhắn họ viết, trong vài giây. Nếu không, câu trả lời hoặc tin nhắn tiếp nối vẫn đến được agent của nó. Hãy nhắc đến một agent để gọi nó. [Agent được chọn thế nào](/help/who-answers)",
              "**Bộ nhớ**, những điều lặp lại bằng cùng từ ngữ vẫn hợp nhất. Những điều lặp lại và cập nhật bằng từ khác vẫn tách rời nhau.",
              "**Màn hình**, agent dùng các con số hiện trên màn hình và tên chính xác. Không có gì được đọc từ hình ảnh.",
            ],
          },
        ],
      },
      {
        id: "setup",
        heading: "Thiết lập nó",
        blocks: [
          {
            list: [
              "Mở https://console.typesafe.ai và đăng nhập bằng Google hoặc email của bạn. Tài khoản mới cũng được tạo theo cách đó.",
              "Thêm credit trong console. Jev được trả trước.",
              "Mở https://console.typesafe.ai/keys, tạo một khóa và sao chép nó ngay.",
              "Trong agentes.chat, mở **Cài đặt › AI và mức sử dụng** và dán nó dưới **Jev**. Chỉ người thiết lập máy chủ này mới thấy nó.",
            ],
          },
          "Đã trả tiền cho OpenRouter rồi? Chọn **OpenRouter** dưới **Jev** và dán một khóa từ https://openrouter.ai/keys, hoặc bật Jev bằng khóa OpenRouter của không gian làm việc chỉ bằng một lần nhấn. Vẫn là Jev đó, tính tiền qua OpenRouter với cùng mức giá.",
          "Trên máy chủ bạn chạy bằng Docker, bạn có thể đặt khóa trong `.env` dưới dạng `TYPESAFE_API_KEY` thay vào đó. Khóa đó thắng khóa trong Cài đặt.",
        ],
      },
      {
        id: "cost",
        heading: "Chi phí của nó",
        blocks: [
          {
            list: [
              "US$ 0.042 cho mỗi triệu token Jev đọc. Câu trả lời của nó miễn phí. Việc chọn ai trả lời đọc khoảng 2,500 token, nên khoảng US$ 0.0001. Một ảnh chụp màn hình khoảng 3,900 token.",
              "Credit bạn mua kéo dài 12 tháng. Bật nạp tự động trong console để Jev không hết credit.",
              "**Cài đặt › AI và mức sử dụng** cho thấy Jev đã đưa ra bao nhiêu quyết định trong tháng này, và chi phí của chúng.",
            ],
          },
        ],
      },
      {
        id: "data",
        heading: "Dữ liệu của bạn",
        blocks: [
          "Những gì Jev đọc để quyết định:",
          {
            list: [
              "Tên và mô tả của kênh, tin nhắn và vài tin nhắn trước nó",
              "Tên và vai trò của các agent của bạn, phần đầu chỉ dẫn của chúng và các công cụ chúng có thể dùng",
              "Các mục bộ nhớ mà nó so sánh",
              "Tác vụ của một agent và phần đầu kết quả công cụ của nó",
              "Mục tiêu của một nhiệm vụ và các lệnh một agent muốn chạy cho nó",
              "Các công cụ một ứng dụng đã kết nối cung cấp",
              "Trang hoặc màn hình một agent đang dùng, kể cả ảnh chụp màn hình",
            ],
          },
          "TypeSafe chạy Jev tại Hoa Kỳ và không huấn luyện mô hình của họ trên những gì bạn gửi. Họ giữ dữ liệu lâu như cần để vận hành dịch vụ. Không lưu giữ dữ liệu có trên các gói doanh nghiệp của họ.",
          "Chính sách quyền riêng tư của TypeSafe, https://typesafe.ai/legal/privacy-policy. Thỏa thuận xử lý dữ liệu của họ, https://typesafe.ai/legal/data-processing.",
          "Với khóa OpenRouter, cùng các yêu cầu đó đi qua OpenRouter trên đường tới TypeSafe, theo điều khoản của OpenRouter và cài đặt quyền riêng tư của bạn ở đó, https://openrouter.ai/privacy.",
        ],
      },
      {
        id: "problems",
        heading: "Khi nó dừng",
        blocks: [
          {
            list: [
              "**Khóa không được chấp nhận**, tạo một khóa mới và dán nó vào **Cài đặt › AI và mức sử dụng**.",
              "**Hết credit**, thêm credit trong console. Jev thử lại trong vòng 30 phút, hoặc nhấp **Kiểm tra lại**.",
              "**Bận hoặc không truy cập được**, TypeSafe có thể giới hạn số yêu cầu mỗi giây, hoặc ngừng trả lời một lúc. Jev tự tiếp tục lại. Giới hạn của bạn, https://console.typesafe.ai/rate-limits. Muốn giới hạn cao hơn, hãy viết cho sales@typesafe.ai.",
            ],
          },
          "Trong lúc đó, agent làm việc như trong [Khi không có nó](/help/jev#without).",
        ],
      },
    ],
  },
  "apps-de-ia": {
    title: "Ứng dụng AI",
    summary:
      "Nhờ các agent của agentes.chat làm tác vụ từ Claude, Cursor hoặc một ứng dụng MCP khác, mà không rời khỏi nó, và nhận câu trả lời ngay tại đó.",
    sections: [
      {
        id: "what",
        heading: "Cách nó hoạt động",
        blocks: [
          "agentes.chat là một máy chủ MCP. Bạn dán địa chỉ của nó vào ứng dụng AI của bạn, đăng nhập bằng tài khoản của bạn và chọn một không gian làm việc. Từ đó, ứng dụng có thể liệt kê agent và kênh, gửi một tác vụ cho một agent với tư cách là bạn, chờ câu trả lời và đọc các tác vụ gần đây.",
          'Ví dụ, giữa một cảnh trong Unity hoặc Blender, hãy hỏi Claude, "Nhờ agent marketing viết một đoạn giới thiệu ra mắt". Tin nhắn hiện trong agentes.chat là của bạn, được đánh dấu **qua Claude**, và câu trả lời của agent quay lại Claude.',
          "Địa chỉ nằm trong **Cài đặt › Ứng dụng AI**. Nó kết thúc bằng `/mcp`.",
        ],
      },
      {
        id: "connect",
        heading: "Kết nối một ứng dụng",
        blocks: [
          {
            list: [
              "**Claude** (claude.ai, Claude Desktop và điện thoại), trong **Tùy chỉnh › Trình kết nối**, nhấp **+ Thêm**, rồi **Thêm trình kết nối tùy chỉnh**, đặt tên nó là agentes.chat, dán địa chỉ và nhấp **Tiếp tục**. Chọn **Đăng nhập ngay**, nhấp **Thêm** và cấp quyền. Trên các gói Team và Enterprise, Chủ sở hữu của tổ chức Claude thêm trình kết nối trong Cài đặt tổ chức › Trình kết nối, và mỗi người nhấp **Kết nối** trong Tùy chỉnh › Trình kết nối. Gói miễn phí của Claude có chỗ cho một trình kết nối tùy chỉnh.",
              "**Claude Code**, chạy `claude mcp add --transport http --scope user agentes <address>`, rồi gõ `/mcp`, chọn agentes và **Xác thực**. Chỉ cho thư mục hiện tại, bỏ `--scope user`.",
              "**Cursor**, **Thêm vào Cursor** trong **Cài đặt › Ứng dụng AI**, hoặc địa chỉ trong `~/.cursor/mcp.json`. Cursor yêu cầu bạn đăng nhập lần đầu bạn dùng nó.",
              '**VS Code**, **Thêm vào VS Code**, hoặc địa chỉ trong `.vscode/mcp.json` với `"type": "http"`.',
              "**Các ứng dụng khác**, ChatGPT, Gemini, Grok, Perplexity, Codex, Zed, JetBrains và nhiều ứng dụng nữa, mỗi cái có các bước riêng trong **Kết nối một ứng dụng**, với địa chỉ của bạn đã điền sẵn.",
            ],
          },
          "Khi bạn đăng nhập, agentes.chat cho biết ứng dụng nào đã yêu cầu truy cập và nó quay lại đâu. Chỉ tiếp tục nếu bạn vừa bắt đầu kết nối.",
        ],
      },
      {
        id: "tools",
        heading: "Ứng dụng có thể làm gì",
        blocks: [
          {
            list: [
              "`send_to_agent`, gửi một tin nhắn từ bạn cho một agent, trong cuộc trò chuyện riêng của bạn với nó hoặc trong một kênh, và chờ câu trả lời. Chỉ với quyền truy cập **Đọc và gửi tác vụ cho agent**.",
              "`wait_for_reply`, tiếp tục chờ câu trả lời của một tác vụ.",
              "`list_agents`, các agent bạn thấy.",
              "`list_channels`, các kênh bạn đọc.",
              "`read_conversation`, các tin nhắn gần đây của một kênh, một thread hoặc một tác vụ.",
              "`list_recent_tasks`, các tác vụ bạn đã gửi từ ứng dụng và những gì agent đang làm lúc này.",
            ],
          },
          "Ứng dụng hành động với tư cách là bạn và chỉ thấy những gì bạn thấy. Nó không bao giờ phê duyệt hành động của agent, khi một agent dừng lại để xin phê duyệt, câu trả lời cho biết điều đó kèm một liên kết, và một người quyết định trong agentes.chat. Nó cũng không thay đổi cài đặt, thành viên hay quyền.",
        ],
      },
      {
        id: "workspace",
        heading: "Một không gian làm việc cho mỗi kết nối",
        blocks: [
          "Mỗi kết nối bao gồm không gian làm việc được chọn khi đăng nhập. Muốn dùng một không gian làm việc khác, hãy kết nối ứng dụng lại và chọn cái kia.",
          "Trong **Cài đặt › Ứng dụng AI**, bạn thấy các ứng dụng đã kết nối, mỗi cái được dùng lần cuối khi nào, và ngắt kết nối bất kỳ cái nào. Những người quản lý thành viên thấy ứng dụng của toàn bộ không gian làm việc và cũng có thể ngắt kết nối chúng. Mọi tin nhắn gửi từ một ứng dụng đều hiện trong Nhật ký kiểm toán.",
        ],
      },
      {
        id: "tokens",
        heading: "Token cá nhân",
        blocks: [
          "Cho các script và ứng dụng không có đăng nhập OAuth, hãy tạo một token cá nhân trong **Cài đặt › Ứng dụng AI** và gửi nó trong header `Authorization: Bearer`. Token chỉ hiện một lần, chỉ hoạt động trong không gian làm việc nơi nó được tạo, và có thể hết hạn sau 30 ngày, 90 ngày, 1 năm hoặc không bao giờ.",
          "Trên máy chủ không có https, ở xa máy tính của chính nó, hãy dùng token cá nhân, đăng nhập OAuth cần https.",
        ],
      },
      {
        id: "limits",
        heading: "Giới hạn",
        blocks: [
          {
            list: [
              "Tối đa 120 yêu cầu mỗi phút và 5,000 mỗi ngày cho mỗi kết nối.",
              "Tối đa 20 tin nhắn mỗi phút và 500 mỗi ngày cho mỗi người trong mỗi không gian làm việc.",
              "Một lần chờ kéo dài tối đa 45 giây. Khi agent vẫn đang làm việc, ứng dụng chờ lại.",
            ],
          },
        ],
      },
      {
        id: "safety",
        heading: "Văn bản của người khác",
        blocks: [
          "Câu trả lời mang văn bản do agent và mọi người trong agentes.chat viết. Ứng dụng nhận văn bản đó được đánh dấu là nội dung, không phải chỉ dẫn, nhưng một văn bản vẫn có thể cố thuyết phục ứng dụng làm điều khác. Hãy kiểm tra những gì ứng dụng của bạn sắp làm trước khi bạn xác nhận.",
        ],
      },
      {
        id: "problems",
        heading: "Khi nó không kết nối được",
        blocks: [
          {
            list: [
              "**Yêu cầu đã hết hạn**, trang đăng nhập kéo dài 30 phút và dùng được một lần. Quay lại ứng dụng và kết nối lại.",
              "**Ứng dụng yêu cầu đăng nhập lại**, kết nối đã bị ngắt, mật khẩu đã thay đổi hoặc bạn đã rời không gian làm việc. Đăng nhập lại từ ứng dụng.",
              "**Cursor kẹt ở một lần đăng nhập cũ**, thoát Cursor, xóa thư mục `~/.mcp-auth` và kết nối lại.",
            ],
          },
        ],
      },
    ],
  },
  "install-on-a-server": {
    title: "Cài agentes.chat trên máy chủ",
    summary:
      "Chạy agentes.chat trên máy chủ của riêng bạn, miễn phí, cho toàn bộ nhóm của bạn. Một lệnh sẽ thiết lập nó.",
    sections: [
      {
        id: "choose",
        heading: "Chọn cách thiết lập nào",
        blocks: [
          {
            list: [
              "**agentes.chat Cloud**, cho mọi nhóm, truy cập được từ bất cứ đâu. Chúng tôi chạy nó, cập nhật nó và sao lưu nó. Mỗi không gian làm việc có máy tính riêng, nơi mỗi agent là một người dùng riêng.",
              "**Máy tính của bạn, với ứng dụng**, cho bạn hoặc một nhóm nhỏ, truy cập được khi máy tính đó đang bật. Một chiếc Mac mini luôn bật hoạt động tốt. Bạn cập nhật nó bằng một lần nhấp và sao lưu nó bằng tay. Agent chạy với tư cách là bạn trên máy tính đó.",
              "**Một máy chủ**, cho nhóm lớn hơn, luôn hoạt động. Bạn cập nhật nó bằng ba lệnh, và nó có thể tự sao lưu mỗi ngày. Trên Debian 13, mỗi agent là một người dùng riêng.",
            ],
          },
          "Từ máy tính của bạn sang máy chủ, [Chuyển sang máy chủ](/help/run-on-your-computer#moving). Bất kỳ cách nào cũng có thể mang agent từ cách khác đến bằng [Mang agent của bạn đến](/help/import).",
        ],
      },
      {
        id: "need",
        heading: "Những gì bạn cần",
        blocks: [
          {
            list: [
              "Một máy chủ hoặc VPS chạy Linux 64-bit, trên x64 hoặc arm64. Cho một nhóm nhỏ, 2 CPU, 4 GB bộ nhớ và 20 GB ổ đĩa là khởi đầu tốt. Trên máy Mac hoặc PC, [ứng dụng chạy agentes.chat](/help/run-on-your-computer) mà không cần Docker.",
              "Docker với Compose. Trên Linux, trình cài đặt thêm chúng khi chúng còn thiếu, sau khi hỏi bạn.",
              "Một cách để truy cập, một tài khoản Tailscale miễn phí (mặc định, riêng tư, không cần tên miền và không cần mở cổng), hoặc một tên miền trỏ tới máy chủ, với cổng 80 và 443 mở.",
            ],
          },
        ],
      },
      {
        id: "install",
        heading: "Cài đặt nó",
        blocks: [
          "Trên máy chủ, chạy:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh",
          },
          "Nó cài những gì còn thiếu, rồi hỏi vài câu, mọi người truy cập nó thế nào, email, máy chủ này có đồng thời là máy tính của các agent của bạn không, và có gửi thống kê sử dụng ẩn danh không. Nhấn Enter để chọn câu trả lời được gợi ý. Nó cài vào `/opt/agentes` (`~/agentes` cho người dùng đã dùng được Docker), và lần đầu nó tải xuống khoảng 2 GB.",
          "Nó kết thúc bằng địa chỉ máy chủ của bạn và một mã QR cho điện thoại của bạn. Chạy lại nó là an toàn, nó giữ cài đặt của bạn và chỉ điền những gì còn thiếu.",
          "Với Node.js 18 trở lên, `npx @agenteschat/setup` trong một thư mục trống là cùng một cách thiết lập. Khi không có Node, nó chạy từ image của ứng dụng, trong thư mục hiện tại, và kết thúc bằng các lệnh khởi động phần còn lại:",
          {
            code: 'docker run --rm -it --user "$(id -u):$(id -g)" -v "$PWD":/work -w /work ghcr.io/agentes-chat/agentes:latest setup',
          },
        ],
      },
      {
        id: "reach",
        heading: "Mọi người truy cập nó thế nào",
        blocks: [
          {
            list: [
              "**Tailscale**, mặc định, HTTPS riêng tư tại `https://agentes.<your-tailnet>.ts.net`, chỉ cho các thiết bị trên mạng Tailscale của bạn. Trước khi cài, bật MagicDNS và HTTPS tại https://console.tailscale.com/admin/dns và tạo một khóa xác thực tại https://console.tailscale.com/admin/settings/keys để phần thiết lập hỏi đến.",
              "**Một tên miền công khai**, bất kỳ ai trên internet cũng mở được nó, tại `https://chat.example.com` chẳng hạn. Trỏ tên miền tới máy chủ và mở cổng 80 và 443. Phần thiết lập lấy chứng chỉ và gia hạn nó, và cho bạn tạo tài khoản trước khi tên miền hoạt động.",
              "**Chỉ máy này**, `http://localhost:3000`, để thử nó trên máy tính của riêng bạn.",
            ],
          },
          "Trên Tailscale, máy chủ rời mạng của bạn khi khóa của nó hết hạn, sau 180 ngày. Muốn giữ nó, hãy mở menu **⋯** của máy chủ tại https://console.tailscale.com/admin/machines và chọn **Disable Key Expiry**.",
          "Webhook khởi động quy trình định kỳ, và ứng dụng AI gọi từ máy chủ của riêng chúng, cần một địa chỉ công khai. Trên Tailscale, Funnel mở cùng địa chỉ đó ra internet, thêm Funnel vào chính sách của tailnet của bạn tại https://console.tailscale.com/admin/acls và đặt `TAILSCALE_FUNNEL=true` trong `.env`, rồi chạy `docker compose up -d`.",
        ],
      },
      {
        id: "owner",
        heading: "Tài khoản của bạn",
        blocks: [
          "Mở địa chỉ máy chủ của bạn và đăng ký, tài khoản đầu tiên trở thành chủ sở hữu. Đăng ký sau đó đóng lại, và mọi người tham gia bằng lời mời, từ **Cài đặt › Thành viên và lời mời**.",
          "Trên Tailscale, những người bạn mời cũng cần tailnet của bạn. Mời họ trước tại https://console.tailscale.com/admin/users rồi mới mời trong agentes.chat.",
        ],
      },
      {
        id: "email",
        heading: "Email",
        blocks: [
          "Khi không có email, agentes.chat ghi mỗi email vào nhật ký của nó thay vì gửi đi, nên liên kết mời vẫn có thể sao chép từ đó. Đặt lại mật khẩu bị tắt, và email mới cho một tài khoản thay đổi ngay, không cần mã hay liên kết.",
          {
            code: "docker compose logs agentes | grep 'email (not sent'",
          },
          "Phần thiết lập dùng máy chủ thư của riêng bạn (SMTP) hoặc một khóa cho API tương thích Resend, như MillionSend hoặc Resend. Email đến từ `ping@<your server's domain>` trừ khi bạn chọn người gửi khác, và tên miền đó phải được xác minh với nhà cung cấp email của bạn. Muốn thiết lập sau, hãy chạy cài đặt lại.",
        ],
      },
      {
        id: "phone",
        heading: "Điện thoại của bạn",
        blocks: [
          {
            list: [
              "Trên Tailscale, cài ứng dụng Tailscale trên điện thoại của bạn và đăng nhập vào cùng một tailnet.",
              "Cài ứng dụng agentes.chat.",
              "Quét mã QR phần thiết lập đã in, hoặc mã trong **Cài đặt › Tài khoản của bạn › Mở trên điện thoại của bạn**, mã này cũng đăng nhập cho bạn.",
            ],
          },
        ],
      },
      {
        id: "computers",
        heading: "Máy tính của các agent của bạn",
        blocks: [
          "Phần thiết lập cũng có thể biến máy chủ này thành máy tính của các agent của bạn, nơi chúng chạy lệnh, dùng trình duyệt và giữ tệp của chúng. Nó sẽ hỏi, và gợi ý đồng ý khi máy chủ làm tốt việc đó. Trên Debian 13, mỗi agent có một người dùng riêng, với một màn hình. Trên Ubuntu, các agent dùng chung một người dùng, `agentes`. Nếu bạn đã từ chối, hãy chạy cài đặt lại với `--computer yes`:",
          {
            code: "curl -fsSL https://agentes.chat/install | sh -s -- --computer yes",
          },
          "Nhiều máy tính hơn, như máy Mac có ứng dụng agentes.chat hoặc một máy chủ khác, kết nối từ **Cài đặt › Thiết bị**, như trong [Máy tính và điện thoại của bạn](/help/computers). Trên Tailscale, chúng tham gia tailnet của bạn trước.",
        ],
      },
      {
        id: "backups",
        heading: "Sao lưu và khôi phục",
        blocks: [
          "Máy chủ của bạn gồm ba thứ, cơ sở dữ liệu, các tệp đã tải lên, và `AGENTES_SECRET` trong `.env`. Giữ một bản sao của `.env` ở nơi an toàn, tách khỏi các bản sao lưu, khi không có bí mật đó, các khóa lưu trong cơ sở dữ liệu đã khôi phục không đọc được.",
          "Muốn sao lưu mỗi ngày, hãy tạo một bucket riêng tư trên Cloudflare R2 hoặc một kho lưu trữ tương thích S3 khác, và một khóa có thể đọc, ghi và xóa trong đó. Thêm chúng vào `.env`, với `backup` trong `COMPOSE_PROFILES` (`https,backup` với tên miền công khai):",
          {
            code: "S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com\nS3_ACCESS_KEY_ID=…\nS3_SECRET_ACCESS_KEY=…\nS3_BACKUP_BUCKET=agentes-backups\nCOMPOSE_PROFILES=tailscale,backup",
          },
          "Rồi chạy `docker compose up -d` trong thư mục cài đặt. Cơ sở dữ liệu được xuất lúc 03:00 UTC và mỗi bản xuất được giữ 14 ngày. `docker compose run --rm backup now` tạo một bản ngay, và `docker compose run --rm backup list` liệt kê chúng. Các bản xuất chỉ chứa cơ sở dữ liệu, các tệp đã tải lên, trong volume `files`, cần một bản sao riêng, và hướng dẫn đầy đủ dưới đây có các lệnh đó.",
          "Muốn khôi phục, hãy mang một bản xuất xuống bằng `docker compose run --rm -T backup fetch <name> > agentes.dump`, rồi nạp nó vào một cơ sở dữ liệu trống khi ứng dụng đã dừng:",
          {
            code: "docker compose stop agentes\ndocker compose exec -T postgres dropdb -U agentes --force agentes\ndocker compose exec -T postgres createdb -U agentes agentes\ndocker compose exec -T postgres pg_restore -U agentes -d agentes --exit-on-error < agentes.dump\ndocker compose start agentes",
          },
          "Khôi phục vào phiên bản đã tạo bản xuất, hoặc một phiên bản mới hơn.",
        ],
      },
      {
        id: "upgrades",
        heading: "Nâng cấp",
        blocks: [
          "Trong thư mục cài đặt, chạy:",
          {
            code: "curl -fsSLO https://agentes.chat/install/docker-compose.yml\ndocker compose pull\ndocker compose up -d",
          },
          "Cơ sở dữ liệu tự cập nhật khi phiên bản mới khởi động. Giữ cài đặt của bạn trong `.env` và không bao giờ sửa `docker-compose.yml`, vì mỗi lần nâng cấp thay thế nó. Sao lưu trước một bước nhảy lớn, cơ sở dữ liệu mà phiên bản mới hơn đã cập nhật sẽ không mở được trong phiên bản cũ hơn.",
        ],
      },
      {
        id: "data",
        heading: "Những gì nó gửi",
        blocks: [
          "Mỗi ngày một lần, máy chủ gửi cho agentes.chat thống kê sử dụng ẩn danh, các con số như số người, số agent, kích thước máy, số token AI đã dùng, lượng dữ liệu trình duyệt của agent gửi và nhận, và tốc độ mở và chạy của các ứng dụng. Không bao giờ có tin nhắn, tệp, tên hay trang web. `docker compose run --rm agentes telemetry` in chính xác những gì nó sẽ gửi. Chủ sở hữu tắt nó trong **Cài đặt › Chung**, hoặc bằng `TELEMETRY=off` trong `.env`.",
          "Báo cáo lỗi không đi đâu trừ khi bạn đặt `SENTRY_DSN` tới một máy chủ tương thích Sentry do bạn chọn. Một báo cáo chứa lỗi và nơi nó xảy ra, không bao giờ có tin nhắn, email, địa chỉ IP, cookie hay token.",
        ],
      },
      {
        id: "reference",
        heading: "Hướng dẫn đầy đủ",
        blocks: [
          "Mọi cài đặt, một proxy của riêng bạn như nginx, chạy mà không cần Docker, một runbook cho các agent AI cài đặt nó, và việc cần làm khi có gì đó hỏng đều có trong `SELF_HOSTING.md`, trong kho agentes.chat.",
        ],
      },
    ],
  },
};
