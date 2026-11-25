import { plural } from "@agenteschat/i18n/format";
import { atHost, sentences } from "./en";
import type { EmailWords } from "./index";

/**
 * The emails in vi: whatever is here replaces English, word group by word group (`deepMerge`); write a count's
 * forms with `plural("vi", n, { other })` from `@agenteschat/i18n/format`.
 */
export const words: EmailWords = {
  sentBy: (host) => (host ? atHost("Được gửi bởi máy chủ agentes.chat", "tại", host) : "Được gửi bởi agentes.chat."),
  fallback: "Nút không hoạt động? Hãy sao chép địa chỉ này vào trình duyệt của bạn:",
  role: { owner: "chủ sở hữu", member: "thành viên" },
  anAgent: "Một agent",
  someone: "Ai đó",
  verify: {
    subject: "Xác nhận email của bạn cho agentes.chat",
    preheader: "Một lần nhấp để xác nhận địa chỉ này. Liên kết có hiệu lực trong một giờ.",
    headline: "Xác nhận email của bạn",
    body: "Chỉ còn một bước nữa: hãy xác nhận địa chỉ này là của bạn.",
    button: "Xác nhận email",
    small: "Liên kết có hiệu lực trong một giờ. Nếu bạn không đăng ký, bạn có thể bỏ qua email này.",
    why: "Bạn nhận được email này vì địa chỉ này đã được dùng để đăng ký agentes.chat.",
  },
  reset: {
    subject: "Đặt lại mật khẩu agentes.chat của bạn",
    preheader: "Chọn một mật khẩu mới. Liên kết có hiệu lực trong một giờ.",
    headline: "Chọn một mật khẩu mới",
    body: "Chúng tôi đã nhận được yêu cầu đặt lại mật khẩu cho địa chỉ này.",
    button: "Chọn mật khẩu mới",
    note: "Không phải bạn yêu cầu? Hãy bỏ qua email này. Mật khẩu của bạn vẫn giữ nguyên.",
    small: "Liên kết có hiệu lực trong một giờ.",
    why: "Bạn nhận được email này vì ai đó đã yêu cầu đặt lại mật khẩu cho địa chỉ này trên agentes.chat.",
  },
  invitation: {
    subject: "Bạn được mời vào một không gian làm việc trên agentes.chat",
    preheader: "Hãy chấp nhận trong vòng 7 ngày, bằng địa chỉ email này.",
    headline: "Bạn được mời vào một không gian làm việc",
    body: (inviter, email, org, role) =>
      inviter
        ? [{ b: inviter }, `${email ? ` (${email})` : ""} đã mời bạn tham gia `, { b: org }, ` với vai trò ${role}.`]
        : ["Bạn được mời tham gia ", { b: org }, ` với vai trò ${role}.`],
    starts: (channels, agents) =>
      sentences(
        channels && ["Bạn sẽ bắt đầu tại ", ...channels, "."],
        agents && ["Bạn sẽ làm việc cùng ", ...agents, "."],
      ),
    more: (n) => `${n} nữa`,
    what: "agentes.chat là nơi mọi người và các agent AI cùng làm việc.",
    noteFrom: (inviter, note) => [{ b: inviter ? `${inviter}: ` : "Ghi chú: " }, `“${note}”`],
    button: "Chấp nhận lời mời",
    small: "Lời mời có hiệu lực trong 7 ngày. Hãy chấp nhận bằng địa chỉ email này.",
    why: (org) =>
      `Bạn nhận được email này vì ai đó tại ${org} đã mời địa chỉ này. Nếu bạn không quen họ, hãy bỏ qua email này. Sẽ không có gì xảy ra cho đến khi bạn chấp nhận.`,
    personal: {
      body: (inviter, email) =>
        inviter
          ? [
              { b: inviter },
              `${email ? ` (${email})` : ""} đã mời bạn vào không gian làm việc cá nhân của họ trên agentes.chat.`,
            ]
          : "Bạn được mời vào một không gian làm việc cá nhân trên agentes.chat.",
      why: () =>
        "Bạn nhận được email này vì ai đó đã mời địa chỉ này vào không gian làm việc cá nhân của họ. Nếu bạn không quen họ, hãy bỏ qua email này. Sẽ không có gì xảy ra cho đến khi bạn chấp nhận.",
    },
  },
  inviteRequest: {
    subject: "Ai đó đang xin một lời mời mới",
    preheader: "Lời mời của họ đã hết hạn. Bạn có thể gửi lời mời mới từ mục Thành viên.",
    headline: "Ai đó đang xin một lời mời mới",
    body: (email, org) =>
      email
        ? [{ b: email }, " đã mở một lời mời đã hết hạn vào ", { b: org }, " và đang xin một lời mời mới."]
        : ["Ai đó có liên kết mời đã hết hạn vào ", { b: org }, " đang xin một liên kết mới."],
    next: "Nếu bạn đang chờ họ, hãy gửi lời mời mới từ mục Thành viên. Nếu không, bạn không cần làm gì cả.",
    button: "Mở mục Thành viên",
    why: (org) => `Bạn nhận được email này vì bạn đã tạo lời mời này, hoặc bạn quản lý thành viên của ${org}.`,
    personal: {
      body: (email) =>
        email
          ? [{ b: email }, " đã mở một lời mời đã hết hạn vào không gian làm việc của bạn và đang xin một lời mời mới."]
          : "Ai đó có liên kết mời đã hết hạn vào không gian làm việc của bạn đang xin một liên kết mới.",
      why: () =>
        "Bạn nhận được email này vì bạn đã tạo lời mời này, hoặc bạn phụ trách những người trong không gian làm việc của bạn.",
    },
  },
  calendar: {
    subject: "Bạn được mời tham dự một sự kiện",
    preheader: (when) => `${when}. Hãy xem trong lịch.`,
    headline: "Bạn được mời tham dự một sự kiện",
    facts: { event: "Sự kiện", when: "Thời gian", org: "Không gian làm việc", by: "Người mời" },
    someone: "Ai đó",
    button: "Xem sự kiện",
    why: (org) => `Bạn nhận được email này vì ai đó tại ${org} đã mời bạn tham dự một sự kiện.`,
    personal: {
      why: () => "Bạn nhận được email này vì ai đó trong không gian làm việc của bạn đã mời bạn tham dự một sự kiện.",
    },
  },
  waitlist: {
    subject: "Xác nhận vị trí của bạn trong danh sách chờ của agentes.chat",
    preheader: "Một lần nhấp và vị trí của bạn được giữ.",
    headline: "Xác nhận vị trí của bạn trong danh sách",
    body: (email) =>
      email
        ? ["Chúng tôi đã nhận được yêu cầu đưa ", { b: email }, " vào danh sách chờ của agentes.chat."]
        : "Chúng tôi đã nhận được yêu cầu đưa địa chỉ này vào danh sách chờ của agentes.chat.",
    approve: "Ở đây, không có việc quan trọng nào diễn ra mà không có người phê duyệt. Yêu cầu này cũng vậy.",
    button: "Xác nhận email của tôi",
    small:
      "Liên kết có hiệu lực trong 48 giờ. Không phải bạn? Hãy bỏ qua email này. Nếu không nhấp, địa chỉ sẽ không bao giờ vào danh sách.",
    why: "Bạn nhận được email này vì địa chỉ này đã được nhập vào danh sách chờ của agentes.chat.",
  },
  earlyAccess: {
    subject: "Lời mời agentes.chat của bạn đã đến",
    preheader: (days) => `Hãy tạo tài khoản trong vòng ${days} ngày, bằng địa chỉ email này.`,
    headline: "Quyền truy cập của bạn đã sẵn sàng",
    body: (email) => [{ b: email }, " giờ có thể tạo tài khoản và không gian làm việc trên agentes.chat."],
    what: "agentes.chat là nơi mọi người và các agent AI cùng làm việc.",
    button: "Tạo tài khoản của tôi",
    small: (days) =>
      `Liên kết có hiệu lực trong ${days} ngày, chỉ dành cho địa chỉ này. Hãy đăng ký bằng mật khẩu, hoặc bằng Google, GitHub hay Apple với cùng địa chỉ này.`,
    why: "Bạn nhận được email này vì địa chỉ này nằm trong danh sách chờ của agentes.chat, hoặc đã được mời vào agentes.chat. Sẽ không có gì xảy ra cho đến khi bạn đăng ký.",
  },
  earlyAccessAllowed: {
    subject: "Giờ bạn có thể tạo không gian làm việc của riêng mình",
    preheader: "Hãy đăng nhập bằng tài khoản bạn đã có và thiết lập nó.",
    headline: "Tạo không gian làm việc của riêng bạn",
    body: (email) => [
      "Giờ bạn có thể tạo không gian làm việc của riêng mình trên agentes.chat bằng ",
      { b: email },
      ", tài khoản bạn đã có.",
    ],
    button: "Tạo không gian làm việc của tôi",
    why: "Bạn nhận được email này vì tài khoản này đã được cấp quyền truy cập sớm vào agentes.chat.",
  },
  budget: {
    subject: {
      warning: "Một agent đã vượt 80% ngân sách hằng tháng của nó",
      exhausted: "Một agent đã dừng lại: đã đạt ngân sách hằng tháng",
    },
    preheader: {
      warning: "Ở mức 100% nó sẽ dừng lại cho đến khi sang tháng mới hoặc giới hạn được nâng lên.",
      exhausted: "Nó sẽ không trả lời cho đến khi sang tháng mới hoặc giới hạn được nâng lên.",
    },
    headline: { warning: "Một agent đã vượt 80% ngân sách của nó", exhausted: "Một agent đã đạt ngân sách của nó" },
    used: (pct, org) => `Đã dùng ${pct} ngân sách của tháng này · ${org}`,
    warning:
      "Ở mức 100% nó sẽ dừng lại và thông báo điều đó trong kênh. Quản trị viên có thể thay đổi giới hạn trên trang của agent.",
    exhausted: "Nó sẽ không trả lời cho đến khi sang tháng mới, hoặc cho đến khi quản trị viên nâng giới hạn.",
    button: "Xem ngân sách",
    why: (org) =>
      `Bạn nhận được email này vì bạn sở hữu agent này, hoặc bạn là quản trị viên của ${org}. Email được gửi ở mức 80% và ở mức 100%, mỗi mức một lần mỗi tháng.`,
    personal: {
      warning: "Ở mức 100% nó sẽ dừng lại và cho bạn biết. Bạn có thể thay đổi giới hạn trên trang của agent.",
      exhausted:
        "Nó sẽ không trả lời cho đến khi sang tháng mới, hoặc cho đến khi bạn nâng giới hạn trên trang của agent.",
      why: () =>
        "Bạn nhận được email này vì agent này là của bạn. Email được gửi ở mức 80% và ở mức 100%, mỗi mức một lần mỗi tháng.",
    },
  },
  digest: {
    subject: (n) =>
      plural("vi", n, {
        other: `${n} yêu cầu đang chờ bạn phê duyệt`,
      }),
    preheader: "Các yêu cầu hết hạn sau 24 giờ, và không có gì chạy khi chưa có quyết định.",
    headline: (n) => plural("vi", n, { other: `${n} yêu cầu đang chờ bạn` }),
    body: (n, org) => [
      "Tại ",
      { b: org },
      plural("vi", n, {
        other: ", các agent đã xin làm những việc chỉ một người mới phê duyệt được.",
      }),
    ],
    age: (h) => `${h}\u00a0giờ trước`,
    more: (k) => `Và thêm ${k} nữa.`,
    button: (n) => plural("vi", n, { other: "Mở mục phê duyệt" }),
    why: (org, hours) =>
      `Bạn nhận được email này vì bạn có thể phê duyệt các yêu cầu này trong ${org}.${hours ? ` Email được gửi khi một yêu cầu chờ hơn ${hours} giờ, mỗi yêu cầu một lần.` : ""}`,
    personal: {
      body: (n) =>
        plural("vi", n, {
          other: "Các agent của bạn đã xin làm những việc cần bạn phê duyệt.",
        }),
      why: (_org, hours) =>
        `Bạn nhận được email này vì bạn có thể phê duyệt các yêu cầu này.${hours ? ` Email được gửi khi một yêu cầu chờ hơn ${hours} giờ, mỗi yêu cầu một lần.` : ""}`,
    },
  },
  ready: {
    subject: "Máy tính của các agent của bạn đã sẵn sàng",
    preheader: {
      ai: "Tiếp theo: kết nối AI của bạn, để các agent của bạn có thể suy nghĩ.",
      task: "Tiếp theo: giao cho các agent của bạn một tác vụ đầu tiên.",
      create: "Tiếp theo: tạo agent đầu tiên của bạn.",
    },
    headline: "Máy tính của các agent của bạn đã sẵn sàng",
    computer: "Máy tính của các agent của bạn",
    body: (org) => [
      "Cảm ơn bạn đã chờ. Máy tính của ",
      { b: org },
      " đã bật và được thiết lập, với một người dùng riêng cho mỗi agent. Nó hoạt động ngày đêm, nên các agent của bạn có thể làm việc bất cứ lúc nào.",
    ],
    facts: { cpus: "CPU", memory: "Bộ nhớ", disk: "Ổ đĩa" },
    next: "Các bước tiếp theo",
    steps: {
      ai: [
        "Kết nối AI của bạn.",
        "Hãy đăng nhập bằng gói Claude hoặc ChatGPT của bạn, gói lập trình của một AI khác, hoặc một khóa API. Các agent của bạn suy nghĩ bằng nó.",
      ],
      task: ["Giao một tác vụ đầu tiên.", "Trong #general, hãy gọi một agent bằng @ và nói điều bạn cần."],
      watch: [
        "Xem chúng làm việc.",
        "Trên trang của một agent, hãy nhấn Mở để xem máy tính của nó trực tiếp. Bạn có thể nắm quyền điều khiển bất cứ lúc nào, và trả lại khi xong.",
      ],
      create: ["Tạo một agent.", "Nó làm việc trên máy tính này ngay từ đầu."],
    },
    button: { ai: "Kết nối AI của tôi", task: "Giao một tác vụ đầu tiên", create: "Tạo một agent" },
    why: (org) =>
      `Bạn nhận được email này vì bạn sở hữu ${org} trên agentes.chat. Đây là email duy nhất về máy tính này.`,
    personal: {
      body: () =>
        "Cảm ơn bạn đã chờ. Máy tính của các agent của bạn đã bật và được thiết lập, với một người dùng riêng cho mỗi agent. Nó hoạt động ngày đêm, nên các agent của bạn có thể làm việc bất cứ lúc nào.",
      steps: {
        task: [
          "Giao một tác vụ đầu tiên.",
          "Hãy mở một cuộc trò chuyện với một trong các agent của bạn và nói điều bạn cần.",
        ],
      },
      why: () =>
        "Bạn nhận được email này vì không gian làm việc này trên agentes.chat là của bạn. Đây là email duy nhất về máy tính này.",
    },
  },
  joinRequest: {
    subject: "Ai đó xin tham gia không gian làm việc của bạn",
    preheader: "Hãy phê duyệt hoặc từ chối trong mục Thành viên. Sẽ không có gì xảy ra cho đến khi bạn trả lời.",
    headline: "Một yêu cầu tham gia đang chờ",
    body: (org) => ["Họ đã mở liên kết mời của ", { b: org }, " và xin tham gia."],
    outside: (by) => [
      "Họ xin tham gia với tư cách cộng tác viên bên ngoài cho ",
      { b: by },
      ". Họ không chiếm một vị trí trong gói của bạn, và bạn có thể loại bỏ họ bất cứ lúc nào.",
    ],
    note: "Chỉ phê duyệt những người bạn đang chờ. Họ sẽ tham gia với vai trò thành viên, trừ khi bạn chọn vai trò khác trên trang.",
    approve: "Phê duyệt",
    deny: "Từ chối",
    more: "Mọi yêu cầu đang chờ đều nằm trong mục Thành viên.",
    why: (org) =>
      `Bạn nhận được email này vì bạn là chủ sở hữu hoặc quản trị viên của ${org}. Email được gửi tối đa một lần mỗi giờ.`,
    personal: {
      body: () => "Họ đã mở liên kết mời của không gian làm việc của bạn và xin tham gia.",
      why: () =>
        "Bạn nhận được email này vì bạn phụ trách việc ai tham gia không gian làm việc của bạn. Email được gửi tối đa một lần mỗi giờ.",
    },
  },
  joinAnswer: {
    someone: "Ai đó",
    joined: {
      subject: "Yêu cầu tham gia của bạn đã được phê duyệt",
      preheader: "Bạn đã vào. Hãy mở không gian làm việc để bắt đầu.",
      headline: "Bạn đã vào",
      body: (who, org, role) => [
        `${who} đã phê duyệt yêu cầu của bạn. Bạn đã tham gia `,
        { b: org },
        ` với vai trò ${role}.`,
      ],
      button: "Mở không gian làm việc",
    },
    invited: {
      subject: "Yêu cầu tham gia của bạn đã được phê duyệt",
      preheader: "Chỉ còn một bước nữa: hãy chấp nhận lời mời trong vòng 7 ngày.",
      headline: "Đã phê duyệt: chỉ còn một bước nữa",
      body: (who, org) => [`${who} đã phê duyệt yêu cầu tham gia của bạn vào `, { b: org }, "."],
      next: "Hãy chấp nhận lời mời bằng địa chỉ email này trong vòng 7 ngày.",
      button: "Chấp nhận lời mời",
    },
    denied: {
      subject: "Yêu cầu tham gia của bạn không được phê duyệt",
      preheader: "Ai đó tại không gian làm việc đã xem xét và không phê duyệt nó.",
      headline: "Yêu cầu của bạn không được phê duyệt",
      body: (org) => ["Ai đó tại ", { b: org }, " đã xem xét yêu cầu của bạn và không phê duyệt nó."],
      reason: (reason) => [{ b: "Ghi chú của họ: " }, `“${reason}”`],
      small: "Nếu bạn nghĩ đây là nhầm lẫn, hãy nhờ ai đó ở đó mời bạn qua email.",
    },
    why: (org) => `Bạn nhận được email này vì địa chỉ này đã xin tham gia ${org} trên agentes.chat.`,
    personal: {
      joined: { body: (who) => `${who} đã phê duyệt yêu cầu của bạn. Giờ bạn đã ở trong không gian làm việc của họ.` },
      invited: { body: (who) => `${who} đã phê duyệt yêu cầu tham gia không gian làm việc của họ của bạn.` },
      denied: {
        preheader: "Họ đã xem xét và không phê duyệt nó.",
        body: () => "Người bạn đã hỏi đã xem xét yêu cầu của bạn và không phê duyệt nó.",
        small: "Nếu bạn nghĩ đây là nhầm lẫn, hãy nhờ họ mời bạn qua email.",
      },
      why: () =>
        "Bạn nhận được email này vì địa chỉ này đã xin tham gia một không gian làm việc cá nhân trên agentes.chat.",
    },
  },
  joinCode: {
    subject: (code) => `${code} là mã agentes.chat của bạn`,
    preheader: "Hãy nhập mã trên trang để xin tham gia. Mã có hiệu lực trong 10 phút.",
    headline: "Mã của bạn",
    body: (org) => ["Hãy nhập mã này trên trang để xin tham gia ", { b: org }, "."],
    small: ["Mã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu, ", { nobr: "hãy bỏ qua email này." }],
    why: (org) => `Bạn nhận được email này vì ai đó đã nhập địa chỉ này để xin tham gia ${org} trên agentes.chat.`,
    personal: {
      body: () => "Hãy nhập mã này trên trang để xin tham gia không gian làm việc này.",
      why: () =>
        "Bạn nhận được email này vì ai đó đã nhập địa chỉ này để xin tham gia một không gian làm việc cá nhân trên agentes.chat.",
    },
  },
  deletionCode: {
    subjectWorkspace: (code) => `${code} là mã của bạn để xóa một không gian làm việc`,
    subjectAccount: (code) => `${code} là mã của bạn để xóa toàn bộ tài khoản`,
    subjectReset: (code) => `${code} là mã của bạn để đặt lại một không gian làm việc`,
    reset: (org) => [
      "Hãy nhập mã này để đặt lại không gian làm việc ",
      { b: org },
      ". Các agent, cuộc trò chuyện, tệp và bộ nhớ của nó bị xóa ngay lập tức và vĩnh viễn, và nó bắt đầu lại như một không gian mới.",
    ],
    whyReset: (org) => `Bạn nhận được email này vì tài khoản của bạn đã yêu cầu đặt lại ${org} trên agentes.chat.`,
    preheader: "Hãy nhập mã trong agentes.chat để xác nhận. Mã có hiệu lực trong 10 phút.",
    headline: "Mã của bạn",
    workspace: (org) => [
      "Hãy nhập mã này để xóa không gian làm việc ",
      { b: org },
      ". Nó chuyển sang chỉ đọc đối với mọi người ngay lập tức và bị xóa vĩnh viễn sau 7 ngày.",
    ],
    account: (email) => [
      "Hãy nhập mã này để xóa toàn bộ tài khoản ",
      { b: email },
      ", chứ không chỉ một không gian làm việc. Nó đăng xuất ở mọi nơi ngay lập tức và bị xóa vĩnh viễn sau 7 ngày, và các không gian làm việc chỉ có mình bạn sẽ đóng cùng với nó.",
    ],
    support: (address) => [
      "Mã có hiệu lực trong 10 phút, và không có gì bị xóa nếu thiếu nó. Nếu không phải bạn, đừng chia sẻ mã và hãy viết thư cho ",
      { mail: address },
      ".",
    ],
    noSupport:
      "Mã có hiệu lực trong 10 phút, và không có gì bị xóa nếu thiếu nó. Nếu không phải bạn, đừng chia sẻ mã và hãy cho những người vận hành máy chủ này biết.",
    whyWorkspace: (org) => `Bạn nhận được email này vì tài khoản của bạn đã yêu cầu xóa ${org} trên agentes.chat.`,
    whyAccount: "Bạn nhận được email này vì tài khoản của bạn đã yêu cầu bị xóa trên agentes.chat.",
    personal: {
      workspace: (org) => [
        "Hãy nhập mã này để xóa không gian làm việc của bạn ",
        { b: org },
        ". Nó chuyển sang chỉ đọc ngay lập tức và bị xóa vĩnh viễn sau 7 ngày.",
      ],
    },
  },
  emailChange: {
    code: {
      subject: (code) => `${code} là mã của bạn để thay đổi email`,
      preheader: "Hãy nhập mã trong agentes.chat để xác nhận. Mã có hiệu lực trong 10 phút.",
      headline: "Mã của bạn",
      body: (email, newEmail) => [
        "Hãy nhập mã này để thay đổi email của tài khoản ",
        { b: email },
        " thành ",
        { b: newEmail },
        ".",
      ],
      support: (address) => [
        "Mã có hiệu lực trong 10 phút, và email của bạn vẫn giữ nguyên nếu thiếu nó. Nếu không phải bạn, đừng chia sẻ mã và hãy viết thư cho ",
        { mail: address },
        ".",
      ],
      noSupport:
        "Mã có hiệu lực trong 10 phút, và email của bạn vẫn giữ nguyên nếu thiếu nó. Nếu không phải bạn, đừng chia sẻ mã và hãy cho những người vận hành máy chủ này biết.",
      why: "Bạn nhận được email này vì tài khoản của bạn đã yêu cầu thay đổi email của nó trên agentes.chat.",
    },
    link: {
      subject: "Xác nhận email mới của bạn cho agentes.chat",
      preheader: "Một lần nhấp để từ nay đăng nhập bằng địa chỉ này. Liên kết có hiệu lực trong một giờ.",
      headline: "Xác nhận email mới của bạn",
      body: "Chỉ còn một bước nữa: hãy xác nhận địa chỉ này là của bạn. Từ đó, tài khoản của bạn đăng nhập bằng nó.",
      button: "Xác nhận email mới",
      small: "Liên kết có hiệu lực trong một giờ. Nếu bạn không yêu cầu việc này, bạn có thể bỏ qua email này.",
      why: "Bạn nhận được email này vì ai đó đã yêu cầu dùng địa chỉ này cho một tài khoản agentes.chat.",
    },
    changed: {
      subject: "Email agentes.chat của bạn đã thay đổi",
      preheader: "Nếu không phải bạn, bạn có thể khôi phục địa chỉ này trong vòng 7 ngày.",
      headline: "Email của bạn đã thay đổi",
      body: (email, newEmail) => ["Tài khoản ", { b: email }, " giờ đăng nhập bằng ", { b: newEmail }, "."],
      notYou:
        "Không phải bạn? Hãy nhấn nút trong vòng 7 ngày. Địa chỉ này sẽ quay lại, mọi phiên đều bị đăng xuất, các ứng dụng AI bị ngắt kết nối và các cách đăng nhập được thêm vào kể từ đó sẽ ngừng hoạt động. Mật khẩu cũng bị xóa, và “Quên mật khẩu” sẽ đặt mật khẩu tiếp theo.",
      button: "Đây không phải tôi",
      small: "Nếu đó là bạn, bạn không cần làm gì cả.",
      why: "Bạn nhận được email này vì địa chỉ này từng là email của một tài khoản agentes.chat.",
    },
  },
  deleting: {
    subject: (day) => `Một không gian làm việc bạn đang tham gia sẽ bị xóa vào ${day}`,
    preheader: "Nó đang ở chế độ chỉ đọc. Chủ sở hữu vẫn có thể khôi phục nó cho đến lúc đó.",
    headline: "Một không gian làm việc đang bị xóa",
    body: (by, org, day, time) => [
      { b: by },
      " đã xóa không gian làm việc ",
      { b: org },
      `. Nó đang ở chế độ chỉ đọc và sẽ biến mất vĩnh viễn vào ${day} lúc ${time}.`,
    ],
    owner: "Đổi ý? Hãy khôi phục nó trước lúc đó.",
    button: "Khôi phục không gian làm việc",
    member: "Nếu đây là nhầm lẫn, hãy nhờ một chủ sở hữu khôi phục nó.",
    why: (org) => `Bạn nhận được email này vì bạn đang ở trong ${org} trên agentes.chat.`,
    personal: {
      member: "Nếu đây là nhầm lẫn, hãy nhờ người đã xóa nó khôi phục nó.",
      why: () => "Bạn nhận được email này vì bạn đang ở trong không gian làm việc này trên agentes.chat.",
    },
  },
  restored: {
    subject: "Một không gian làm việc bạn đang tham gia đã trở lại",
    preheader: "Một chủ sở hữu đã khôi phục nó. Nó hoạt động trở lại.",
    headline: "Không gian làm việc đã trở lại",
    body: (by, org) => [{ b: by }, " đã khôi phục ", { b: org }, ". Nó hoạt động trở lại."],
    button: "Mở không gian làm việc",
    why: (org) => `Bạn nhận được email này vì bạn đang ở trong ${org} trên agentes.chat.`,
    personal: {
      why: () => "Bạn nhận được email này vì bạn đang ở trong không gian làm việc này trên agentes.chat.",
    },
  },
  appConnected: {
    subject: "Một ứng dụng đã được kết nối với tài khoản agentes.chat của bạn",
    preheader: "Nó có thể đọc và gửi tác vụ cho các agent dưới danh nghĩa của bạn trong một không gian làm việc.",
    headline: "Một ứng dụng đã được kết nối",
    body: (app, org) => [{ b: app }, " giờ có quyền truy cập vào tài khoản của bạn trong ", { b: org }, "."],
    note: "Không phải bạn kết nối? Hãy ngắt kết nối nó ngay và thay đổi mật khẩu của bạn.",
    button: "Xem các ứng dụng đã kết nối",
    why: (org) =>
      `Bạn nhận được email này vì một ứng dụng đã được kết nối với tài khoản của bạn trong ${org} trên agentes.chat.`,
    personal: {
      body: (app) => [
        { b: app },
        " giờ có quyền truy cập vào tài khoản của bạn trong không gian làm việc cá nhân của bạn.",
      ],
      why: () =>
        "Bạn nhận được email này vì một ứng dụng đã được kết nối với tài khoản của bạn trong không gian làm việc cá nhân của bạn trên agentes.chat.",
    },
  },
  accountDeleting: {
    subject: (day) => `Tài khoản agentes.chat của bạn sẽ bị xóa vào ${day}`,
    preheader: "Bạn có 7 ngày để đổi ý.",
    headline: "Tài khoản của bạn đang bị xóa",
    body: (email, day, time) => [
      "Chúng tôi sẽ xóa tài khoản ",
      { b: email },
      ` vào ${day} lúc ${time}. Nó bị đăng xuất ở mọi nơi, và không ai liên lạc được với bạn ở đây cho đến khi bạn quay lại.`,
    ],
    closes: (count, names) => [
      plural("vi", count, {
        other: "Không gian làm việc chỉ có mình bạn đã đóng lại và sẽ bị xóa vào cùng ngày: ",
      }),
      ...names,
      ".",
    ],
    undo: "Đổi ý? Hãy đăng nhập trước ngày đó và nhấn Khôi phục.",
    button: "Đăng nhập để khôi phục",
    why: "Bạn nhận được email này vì địa chỉ này có một tài khoản trên agentes.chat.",
  },
  accountDeleted: {
    subject: "Tài khoản agentes.chat của bạn đã bị xóa",
    preheader: "Nó đã bị đăng xuất ở mọi nơi và không thể đăng nhập lại.",
    headline: "Tài khoản của bạn đã bị xóa",
    body: (email) => ["Chúng tôi đã xóa tài khoản ", { b: email }, "."],
    closes: (count, day, names) => [
      plural("vi", count, {
        other: `Không gian làm việc chỉ có mình bạn đã đóng và sẽ bị xóa vĩnh viễn vào ${day}: `,
      }),
      ...names,
      ".",
    ],
    support: (address) => ["Nếu không phải bạn, hãy viết thư cho ", { mail: address }, "."],
    noSupport: "Nếu không phải bạn, hãy cho những người vận hành máy chủ này biết.",
    why: "Bạn nhận được email này vì địa chỉ này từng có một tài khoản trên agentes.chat.",
  },
  autonomy: {
    subject: (day, stalls, noise) => `Các agent vào ${day}: ${stalls} lần bị kẹt, ${noise} lần chạy vô ích`,
    preheader: "Nơi các agent bị dừng lại và nơi chúng hành động vô ích, so với 7 ngày trước đó.",
    headline: (day) => `Các lần bị kẹt và chạy vô ích vào ${day}`,
    body: "Mọi không gian làm việc đang hoạt động trên máy chủ này, trong ngày theo giờ UTC. Chỉ gồm tên và số liệu.",
    stalls: "Bị kẹt",
    noise: "Chạy vô ích",
    metric: {
      mentionNoRun: "Các lượt nhắc đến không đánh thức ai",
      readOnly: "Các lần chạy chỉ có thể đọc",
      promiseUnkept: "Kết thúc khi công việc còn dang dở",
      promiseIgnored: "Vẫn dang dở sau lời nhắc",
      handoffUnanswered: "Các lần bàn giao không được trả lời trong 30 phút",
      limitStops: "Bị dừng bởi một giới hạn",
      personUnanswered: "Những người không được trả lời trong 10 phút",
      taskStartFailed: "Các tác vụ thất bại ngay khi bắt đầu",
      noiseRuns: "Các lần chạy vô ích",
      quietRuns: "Kết thúc mà không nói một lời",
      ackReplies: "Đã trả lời một lời cảm ơn hoặc một câu đồng ý",
      idleWakes: "Bị đánh thức mà không có việc gì làm",
      noiseTokens: "Token của chúng",
      noiseCostNanoUsd: "Chi phí của chúng",
    },
    value: (today, average) => `${today} · Trung bình 7 ngày ${average}`,
    topStalls: "Bị kẹt nhiều nhất",
    topNoise: "Chạy vô ích nhiều nhất, kèm chi phí của chúng",
    none: "Không có không gian làm việc nào.",
    table: (day) => `Toàn bộ bảng: bun run report:autonomy --day ${day}`,
    why: "Bạn nhận được email này vì địa chỉ này nằm trong OPS_REPORT_EMAIL trên máy chủ này. Email được gửi mỗi ngày một lần.",
  },
  accountOpened: {
    subject: (plan) => `Nhiều người hơn có thể dùng tài khoản ${plan} của bạn`,
    preheader: (plan) => `Những gì họ làm với nó sẽ dùng gói ${plan} của bạn và các giới hạn của nó.`,
    headline: "Ai đó đã thay đổi những người có thể dùng tài khoản AI của bạn",
    body: (by, account, plan) => [
      { b: by },
      ` đã thay đổi những người có thể dùng tài khoản ${plan} của bạn `,
      { b: account },
      `. Những gì họ làm với nó sẽ dùng gói của bạn và các giới hạn của nó.`,
    ],
    account: "Tài khoản",
    by: "Người thay đổi",
    setting: "Quyền",
    use: "Dùng trong các agent",
    reply: "Trả lời mọi người",
    was: "Trước",
    now: "Bây giờ",
    everyone: "Mọi người trong không gian làm việc",
    admins: "Bạn và các quản trị viên",
    onlyYou: "Chỉ mình bạn",
    agentOwner: "Chỉ chủ sở hữu của agent",
    note: "Để hoàn tác, hãy mở tài khoản trong mục AI và mức sử dụng rồi thay đổi quyền của nó.",
    button: "Mở các tài khoản AI",
    why: (org) =>
      `Bạn nhận được email này vì bạn đã kết nối tài khoản AI này trong ${org} và ai đó khác đã thay đổi những người có thể dùng nó.`,
    personal: {
      why: () =>
        "Bạn nhận được email này vì bạn đã kết nối tài khoản AI này và ai đó khác đã thay đổi những người có thể dùng nó.",
    },
  },
  planOpened: {
    subject: (plan) => `Nhiều người hơn có thể nói chuyện với agent của bạn bằng gói ${plan} của bạn`,
    preheader: (plan) => `Các cuộc trò chuyện của họ sẽ dùng gói ${plan} của bạn và các giới hạn của nó.`,
    headline: "Nhiều người hơn có thể nói chuyện với agent của bạn",
    body: (by, agent, plan) => [
      { b: by },
      " đã cho nhiều người hơn nói chuyện với ",
      { b: agent },
      `. Các cuộc trò chuyện của họ với nó sẽ dùng gói ${plan} của bạn và các giới hạn của nó.`,
    ],
    agent: "Agent",
    by: "Người thay đổi",
    was: "Trước",
    now: "Bây giờ",
    everyone: "Mọi người trong không gian làm việc",
    onlyYou: "Chỉ mình bạn",
    you: "Bạn",
    note: "Để hoàn tác, hãy thay đổi mục Ai có thể nói chuyện trên trang của agent.",
    button: "Xem ai có thể nói chuyện",
    why: (org) =>
      `Bạn nhận được email này vì một agent của bạn trong ${org} suy nghĩ bằng gói của bạn và ai đó khác đã thay đổi những người có thể nói chuyện với nó.`,
    personal: {
      why: () =>
        "Bạn nhận được email này vì một agent của bạn suy nghĩ bằng gói của bạn và ai đó khác đã thay đổi những người có thể nói chuyện với nó.",
    },
  },
  planLent: {
    subject: (plan) => `Gói ${plan} của bạn giờ suy nghĩ cho một agent khác`,
    preheader: (plan) =>
      `Các cuộc trò chuyện của nó sẽ dùng gói ${plan} của bạn và các giới hạn của nó. Bạn có thể lấy lại.`,
    headline: "Ai đó đã kết nối gói của bạn với một agent",
    body: (by, agent, plan) => [
      { b: by },
      ` đã kết nối gói ${plan} của bạn với `,
      { b: agent },
      ". Các cuộc trò chuyện của nó sẽ dùng gói của bạn và các giới hạn của nó.",
    ],
    agent: "Agent",
    by: "Người kết nối",
    plan: "Gói",
    note: "Hãy lấy lại bằng một lần nhấp từ thông báo của bạn, và agent sẽ ngừng suy nghĩ bằng gói của bạn.",
    button: "Mở thông báo",
    why: (org) => `Bạn nhận được email này vì ai đó trong ${org} đã kết nối gói của bạn với một agent.`,
    personal: {
      why: () =>
        "Bạn nhận được email này vì ai đó trong không gian làm việc của bạn đã kết nối gói của bạn với một agent.",
    },
  },
  planWaiting: {
    subject: "Nhóm của bạn đang chờ",
    preheader: "Không gian làm việc của bạn đã sẵn sàng. Nó cần một gói agentes.chat để bắt đầu.",
    headline: "Nhóm của bạn đang chờ",
    body: (agents, channels, routines) => {
      const a = plural("vi", agents, { other: `${agents} agent` });
      const c = plural("vi", channels, { other: `${channels} kênh` });
      const r = plural("vi", routines, { other: `${routines} quy trình định kỳ` });
      return `${routines > 0 ? `${a}, ${c} và ${r}` : `${a} và ${c}`} đã sẵn sàng. Chúng cần một gói agentes.chat để bắt đầu.`;
    },
    button: "Xem các gói agentes.chat",
    why: (org) =>
      `Bạn nhận được email này vì bạn vận hành ${org} trên agentes.chat. Chúng tôi gửi hai email như thế này rồi dừng.`,
    personal: {
      subject: "Các agent của bạn đang chờ",
      headline: "Các agent của bạn đang chờ",
      body: (agents, _channels, routines) => {
        const a = plural("vi", agents, { other: `${agents} agent` });
        const r = plural("vi", routines, { other: `${routines} quy trình định kỳ` });
        return `Sẵn sàng hoạt động: ${routines > 0 ? `${a} và ${r}` : a}. Chỉ còn thiếu một gói agentes.chat.`;
      },
      why: () =>
        "Bạn nhận được email này vì không gian làm việc này trên agentes.chat là của bạn. Chúng tôi gửi hai email như thế này rồi dừng.",
    },
  },
  surface: {
    linked: {
      subject: (surface) => `${surface} đã được liên kết với tài khoản agentes.chat của bạn`,
      preheader: "Trợ lý của bạn giờ trả lời bạn ở đó. Nếu không phải bạn, hãy hủy liên kết.",
      headline: (surface) => `${surface} đã được liên kết`,
      body: (surface, display, org) => [
        { b: display },
        ` trên ${surface} giờ nói chuyện với trợ lý của bạn trong `,
        { b: org },
        ".",
      ],
      notYou: "Không phải bạn? Hãy hủy liên kết. Tin nhắn từ đó sẽ ngừng đến tài khoản của bạn ngay lập tức.",
      button: "Hủy liên kết",
      small: "Nếu đó là bạn, bạn không cần làm gì cả. Bạn có thể hủy liên kết bất cứ lúc nào trong Cài đặt.",
      why: (surface) => `Bạn nhận được email này vì ${surface} đã được liên kết với tài khoản agentes.chat của bạn.`,
      picture: "Trợ lý của bạn, giờ cũng có trên điện thoại của bạn",
    },
    unlinked: {
      subject: (surface) => `${surface} đã bị hủy liên kết khỏi tài khoản agentes.chat của bạn`,
      preheader: "Danh tính của nó đã thay đổi. Hãy liên kết lại trong Cài đặt nếu đó là bạn.",
      headline: (surface) => `${surface} đã bị hủy liên kết`,
      body: (surface, display) => [
        { b: display },
        ` trên ${surface} đã bị hủy liên kết vì danh tính của nó đã thay đổi.`,
      ],
      small: "Hãy liên kết lại trong Cài đặt nếu đó là bạn.",
      why: (surface) => `Bạn nhận được email này vì ${surface} từng được liên kết với tài khoản agentes.chat của bạn.`,
      picture: "Trợ lý của bạn, không còn trên điện thoại của bạn nữa",
    },
    pinReset: {
      subject: (surface) => `Chọn mã PIN ${surface} của bạn`,
      preheader: "Hãy chọn mã PIN dùng để phê duyệt các hành động từ ứng dụng trò chuyện của bạn.",
      headline: (surface) => `Chọn mã PIN ${surface} của bạn`,
      body: (surface) =>
        `Ai đó đã yêu cầu một liên kết để chọn mã PIN bạn dùng để phê duyệt các hành động từ ${surface}. Nếu đó là bạn, hãy chọn nó trên trang mà nút này mở ra.`,
      button: "Chọn mã PIN của tôi",
      small:
        "Liên kết dùng được một lần, trong một giờ. Nếu không phải bạn, hãy bỏ qua email này. Sẽ không có gì thay đổi.",
      why: (surface) => `Bạn nhận được email này vì ${surface} được liên kết với tài khoản agentes.chat của bạn.`,
    },
    pinLocked: {
      subject: (surface) => `Mã PIN ${surface} của bạn đã bị khóa`,
      preheader: "Ba lần nhập sai mã PIN liên tiếp. Việc phê duyệt từ ứng dụng trò chuyện của bạn tạm dừng lúc này.",
      headline: (surface) => `Mã PIN ${surface} của bạn đã bị khóa`,
      body: (surface, time) =>
        `Ai đó đã nhập sai mã PIN ba lần liên tiếp để phê duyệt một hành động từ ${surface}. Việc phê duyệt từ ${surface} bị tạm dừng trong ${time}.`,
      lockedFor: ["15 phút", "1 giờ", "24 giờ"],
      small: (surface) =>
        `Nếu đó là bạn, hãy thử lại sau. Nếu không, hãy hủy liên kết ${surface} trong cài đặt thông báo của bạn, để không ai có thể phê duyệt từ đó.`,
      button: "Mở cài đặt thông báo",
    },
  },
  supportReply: {
    subject: "Một câu trả lời cho yêu cầu trợ giúp của bạn",
    preheader: "Về sự trợ giúp bạn đã yêu cầu trên agentes.chat.",
    headline: "Một câu trả lời cho yêu cầu trợ giúp của bạn",
    answers: {
      received: "Chúng tôi đã nhận được yêu cầu của bạn và đang xem xét nó.",
      need_more:
        "Chúng tôi cần biết thêm để giúp bạn: bạn đang làm gì, bạn mong đợi điều gì và điều gì đã xảy ra thay vào đó.",
      resolved: "Điều bạn báo cáo đã được khắc phục.",
      handed_over: "Một người giờ đã tiếp nhận yêu cầu của bạn và sẽ trả lời bạn.",
    },
    from: (host) =>
      host
        ? atHost("Được trả lời bởi những người vận hành máy chủ agentes.chat", "tại", host)
        : "Được trả lời bởi agentes.chat.",
    ai: "Một trợ lý AI đã viết câu trả lời này.",
    reply: (address) => ["Để trả lời, hãy viết thư cho ", { mail: address }, "."],
    why: "Bạn nhận được email này vì bạn đã yêu cầu trợ giúp trên agentes.chat.",
  },
};
