import type { LegalDocument, LegalKind } from "./types";

/** Terms and Privacy in vi, each with its courtesy notice: a page not here shows in English. */
export const legalVi: Partial<Record<LegalKind, LegalDocument>> = {
  terms: {
    title: "Điều khoản sử dụng",
    summary:
      "Thỏa thuận về việc sử dụng agentes.chat: không gian làm việc của bạn, các agent của bạn, và trách nhiệm của mỗi bên.",
    courtesy:
      "Đây là bản dịch tham khảo không chính thức. Nếu có khác biệt so với bản tiếng Anh, bản tiếng Anh được ưu tiên áp dụng.",
    updated: "2026-11-20",
    sections: [
      {
        id: "agreement",
        heading: "1. Thỏa thuận",
        blocks: [
          'Các Điều khoản sử dụng này (gọi là "Điều khoản") là một thỏa thuận có tính ràng buộc giữa AGENTESCHAT, LLC, một công ty trách nhiệm hữu hạn tại Delaware hoạt động kinh doanh dưới tên agentes.chat (gọi là "agentes.chat", "chúng tôi"), và cá nhân hoặc tổ chức tạo tài khoản hoặc không gian làm việc (gọi là "bạn"). Khi tạo tài khoản, tham gia một không gian làm việc, hoặc sử dụng agentes.chat theo cách khác trên web, ứng dụng Mac hoặc ứng dụng điện thoại (gọi là "Dịch vụ"), bạn chấp nhận các Điều khoản này và Chính sách bảo mật của chúng tôi. Nếu bạn sử dụng Dịch vụ thay mặt cho một công ty hoặc tổ chức khác, bạn tuyên bố rằng bạn có thẩm quyền ràng buộc công ty hoặc tổ chức đó.',
          "Bạn phải từ 18 tuổi trở lên và có khả năng ký kết hợp đồng để sử dụng Dịch vụ.",
        ],
      },
      {
        id: "service",
        heading: "2. Dịch vụ",
        blocks: [
          "Dịch vụ là một không gian làm việc nơi mọi người và các agent AI cùng làm việc. Dịch vụ bao gồm các kênh, thread và tin nhắn riêng, cùng các agent có vai trò, chỉ dẫn, bộ nhớ và ngân sách riêng. Dịch vụ cũng bao gồm các tác vụ, wiki, Drive, lịch và quy trình định kỳ, các phê duyệt, trình kết nối tới các dịch vụ khác, và tùy chọn kết nối các máy tính mà agent có thể làm việc trên đó.",
          "Dịch vụ còn mới và vẫn đang phát triển: các tính năng có thể thay đổi, bị giới hạn hoặc bị loại bỏ. Chúng tôi có thể chỉ mở tài khoản mới theo lời mời trong một thời gian, hoặc mở cho bất kỳ ai đăng ký. Chúng tôi sẽ thông báo trước cho bạn trước khi loại bỏ một tính năng mà bạn đang dựa vào, trong trường hợp khả thi.",
        ],
      },
      {
        id: "accounts",
        heading: "3. Tài khoản và không gian làm việc",
        blocks: [
          "Bạn chịu trách nhiệm về tính chính xác của thông tin tài khoản của bạn, về tính bảo mật của thông tin đăng nhập của bạn, và về mọi hoạt động dưới tài khoản của bạn. Chủ sở hữu và Quản trị viên của một không gian làm việc quyết định ai tham gia không gian đó, họ có vai trò gì, có những agent nào và các agent đó được phép làm gì. Khi các Điều khoản này nói một không gian làm việc sở hữu, quyết định hoặc chịu trách nhiệm về một việc gì, điều đó có nghĩa là cá nhân hoặc tổ chức đã tạo ra không gian đó, hoặc không gian đó được tạo thay mặt cho họ, hành động thông qua Chủ sở hữu và Quản trị viên của mình. Hãy thông báo kịp thời cho chúng tôi tại security@agentes.chat nếu bạn cho rằng một tài khoản, một khóa hoặc một máy tính đã kết nối đã bị xâm phạm.",
        ],
      },
      {
        id: "agents",
        heading: "4. Agent và những việc agent làm",
        blocks: [
          "Agent hành động theo các chỉ dẫn, quyền, trình kết nối, ngân sách và máy tính mà bạn và không gian làm việc của bạn cấp cho chúng. Những việc một agent làm trong phạm vi các quyền đó, bao gồm tin nhắn agent gửi, mã agent thay đổi, dữ liệu agent đọc, ghi hoặc xóa, và các lệnh agent chạy trên một máy tính, đều được thực hiện thay mặt cho không gian làm việc của bạn, và không gian làm việc của bạn chịu trách nhiệm về những việc đó theo các Điều khoản này. Mỗi agent có một người chịu trách nhiệm về agent đó.",
          "Các hành động khó hoàn tác sẽ trở thành một yêu cầu phê duyệt gửi tới một người trước khi chúng xảy ra, trừ khi không gian làm việc của bạn đã đặt agent đó ở chế độ hành động mà không cần hỏi. Việc phê duyệt một hành động như vậy là quyết định của bạn. Dịch vụ hiển thị việc sắp được thực hiện, nhưng bạn chịu trách nhiệm xem xét việc đó.",
          "Kết quả do AI tạo ra có thể sai, không đầy đủ hoặc đã lỗi thời, ngay cả khi nghe có vẻ chắc chắn. Hãy xem xét những gì agent tạo ra trước khi dựa vào đó, và không sử dụng kết quả đó thay cho tư vấn chuyên môn (pháp lý, y tế, tài chính hoặc các lĩnh vực khác) hoặc làm cơ sở duy nhất cho các quyết định có hiệu lực pháp lý hoặc có tác động quan trọng tương tự đối với mọi người.",
        ],
      },
      {
        id: "acceptable-use",
        heading: "5. Sử dụng hợp lệ",
        blocks: [
          "Bạn đồng ý không sử dụng Dịch vụ, hoặc để agent được sử dụng, nhằm:",
          {
            list: [
              "vi phạm pháp luật, xâm phạm quyền của người khác, hoặc xử lý dữ liệu cá nhân mà không có cơ sở pháp lý",
              "gửi thư rác hoặc tin nhắn không được yêu cầu, hoặc quấy rối, đe dọa, lừa dối hoặc mạo danh bất kỳ ai",
              "tạo hoặc phát tán phần mềm độc hại, nội dung lừa đảo, hoặc nội dung tình dục hóa trẻ vị thành niên, cổ vũ bạo lực hoặc có tính bất hợp pháp khác",
              "vượt qua các giới hạn và biện pháp bảo vệ của Dịch vụ, chẳng hạn như ngân sách, giới hạn tốc độ, phê duyệt, quyền, hoặc các kiểm tra đối với máy tính và cơ sở dữ liệu đã kết nối",
              "tấn công Dịch vụ hoặc tấn công người khác thông qua Dịch vụ, bao gồm dò tìm lỗ hổng bảo mật, làm quá tải Dịch vụ, hoặc cài cắm các chỉ dẫn nhằm chiếm quyền điều khiển agent của người khác",
              "truy cập một dịch vụ, máy tính hoặc dữ liệu mà bạn không được phép sử dụng, hoặc sử dụng một dịch vụ đã kết nối trái với điều khoản của chính dịch vụ đó",
              "vi phạm chính sách sử dụng của các nhà cung cấp mô hình AI vận hành agent của bạn.",
            ],
          },
          "Chúng tôi có thể đình chỉ một agent, một trình kết nối hoặc một tài khoản, kèm thông báo trong trường hợp khả thi, khi hoạt động đe dọa đến tính bảo mật, tính toàn vẹn hoặc hoạt động hợp pháp của Dịch vụ hoặc của người khác. Chúng tôi có thể điều tra các vi phạm bị nghi ngờ đối với mục này, bao gồm việc đọc Nội dung không gian làm việc như Chính sách bảo mật mô tả.",
        ],
      },
      {
        id: "content",
        heading: "6. Nội dung của bạn",
        blocks: [
          '"Nội dung không gian làm việc" có nghĩa là những gì bạn và những người khác trong không gian làm việc của bạn đưa vào Dịch vụ và những gì agent của bạn tạo ra trong Dịch vụ. Không gian làm việc của bạn sở hữu Nội dung không gian làm việc của mình, và trong quan hệ giữa bạn và chúng tôi, kết quả mà agent tạo ra cho bạn thuộc về bạn, tùy thuộc vào điều khoản của nhà cung cấp mô hình đã tạo ra kết quả đó. Kết quả có thể tương tự với những gì cùng các mô hình đó tạo ra cho người khác.',
          "Bạn cấp cho chúng tôi các quyền có giới hạn cần thiết để vận hành Dịch vụ: lưu trữ, xử lý, truyền và hiển thị Nội dung không gian làm việc nhằm vận hành không gian làm việc và agent của bạn, gửi nội dung đó tới các nhà cung cấp mà agent của bạn sử dụng và tới các công ty xử lý nội dung đó thay cho chúng tôi, như được mô tả trong Chính sách bảo mật, cung cấp hỗ trợ, duy trì Dịch vụ hoạt động và an toàn, thực thi các Điều khoản này và tuân thủ pháp luật. Chúng tôi không bán Nội dung không gian làm việc và không sử dụng nội dung đó để huấn luyện các mô hình học máy.",
          "Không gian làm việc của bạn là bên kiểm soát dữ liệu đối với dữ liệu cá nhân trong Nội dung không gian làm việc của mình, và chúng tôi xử lý dữ liệu đó theo chỉ dẫn của không gian làm việc với tư cách là bên xử lý dữ liệu, như được mô tả trong Chính sách bảo mật và Phụ lục xử lý dữ liệu. Vì mục đích tin cậy và an toàn, tính bảo mật của Dịch vụ và những gì pháp luật yêu cầu ở chúng tôi, chúng tôi hành động với tư cách là bên kiểm soát dữ liệu độc lập, như Mục 6 của Chính sách bảo mật mô tả.",
        ],
      },
      {
        id: "third-parties",
        heading: "7. Nhà cung cấp mô hình, trình kết nối và tài khoản riêng của bạn",
        blocks: [
          "Agent chạy trên các mô hình AI của bên thứ ba (chẳng hạn như Anthropic, công ty tạo ra Claude, và OpenAI), thông qua một khóa API mà không gian làm việc của bạn thêm vào hoặc một gói AI, chẳng hạn như Claude hoặc ChatGPT, mà một người trong không gian làm việc của bạn kết nối. Việc sử dụng khóa hoặc gói đó cũng chịu sự điều chỉnh của thỏa thuận của bạn với nhà cung cấp của khóa hoặc gói đó, và bạn chịu trách nhiệm tuân thủ điều khoản của nhà cung cấp đó và thanh toán các khoản phí của họ.",
          "Trình kết nối cho agent quyền truy cập vào các dịch vụ khác (chẳng hạn như GitHub, Google, Linear, Sentry hoặc một hộp thư email). Các dịch vụ đó do bên thứ ba cung cấp theo điều khoản riêng của họ. Tính khả dụng của chúng và cách chúng xử lý dữ liệu nằm ngoài tầm kiểm soát của chúng tôi.",
        ],
      },
      {
        id: "computers",
        heading: "8. Máy tính đã kết nối",
        blocks: [
          "Nếu bạn kết nối một máy tính, bạn cài đặt phần mềm cho phép agent chạy lệnh và sử dụng trình duyệt trên máy tính đó, trong phạm vi các thư mục và quyền bạn đặt trên máy tính đó. Bạn chịu trách nhiệm về máy tính, về những gì bạn cho phép ở đó, và về việc sao lưu những gì quan trọng. Quyền chỉ có thể được mở rộng trên chính máy tính đó, và bạn có thể ngắt kết nối máy tính bất cứ lúc nào.",
        ],
      },
      {
        id: "data-protection",
        heading: "9. Bảo vệ dữ liệu",
        blocks: [
          "Khi GDPR, UK GDPR hoặc LGPD áp dụng đối với dữ liệu cá nhân trong Nội dung không gian làm việc của bạn, mỗi bên sẽ tuân thủ các nghĩa vụ của mình theo luật đó. Một Phụ lục xử lý dữ liệu (DPA) tích hợp Điều khoản hợp đồng tiêu chuẩn của Ủy ban Châu Âu và các điều khoản tương đương của LGPD luôn sẵn có và, khi được ký kết, sẽ được tích hợp vào các Điều khoản này. Hãy yêu cầu tại legal@agentes.chat. Danh sách hiện tại các bên xử lý phụ nằm trong Chính sách bảo mật. Một yêu cầu hỗ trợ mà thành viên của không gian làm việc của bạn gửi cho chúng tôi là chỉ dẫn của không gian làm việc của bạn yêu cầu chúng tôi đọc nội dung mà yêu cầu đó đề cập.",
        ],
      },
      {
        id: "fees",
        heading: "10. Gói dịch vụ, thanh toán và sử dụng hợp lý",
        blocks: [
          "Mỗi không gian làm việc tự thanh toán cho gói agentes.chat của mình. Các quy tắc này áp dụng cho mọi gói:",
          {
            list: [
              "**Bên bán.** Mọi giao dịch mua đều được thực hiện từ, và được xuất hóa đơn bởi, AGENTESCHAT, LLC, một công ty Hoa Kỳ được thành lập tại Delaware.",
              "**Giá.** Các gói và giá của chúng nằm trên trang giá của chúng tôi. Giá tính bằng đô la Mỹ, và thuế được cộng thêm khi áp dụng. Ngân hàng hoặc nhà cung cấp thanh toán của bạn có thể thu phí riêng đối với các giao dịch mua từ nước ngoài, chẳng hạn như IOF tại Brazil.",
              "**Gia hạn.** Một gói tự động gia hạn mỗi tháng hoặc mỗi năm, tùy theo kỳ đã chọn, cho đến khi bị hủy. Chúng tôi gửi lời nhắc trước khi một gói theo năm gia hạn.",
              "**Hủy.** Bạn có thể hủy bất cứ lúc nào, và việc hủy có hiệu lực vào cuối kỳ đã thanh toán. Sau đó agent của không gian làm việc dừng lại, máy tính của không gian đó bị xóa dữ liệu sau 7 ngày, và các cuộc trò chuyện cùng tệp của không gian đó vẫn có thể đọc và tải xuống trong 90 ngày, sau thời gian đó chúng bị xóa.",
              "**Không hoàn tiền.** Mỗi gói phát sinh chi phí vận hành ngay từ thời điểm được mua, chẳng hạn như việc sử dụng mô hình AI, máy chủ và máy tính của không gian làm việc. Vì lý do đó, các giao dịch mua là cuối cùng và không được hoàn tiền, toàn bộ hay một phần, bao gồm phần còn lại của một kỳ sau khi hủy.",
              "**Thanh toán thất bại.** Nếu một khoản thanh toán thất bại, chúng tôi sẽ thử lại trong những ngày tiếp theo. Nếu vẫn thất bại, không gian làm việc bị tạm dừng: agent của không gian đó dừng lại, và mọi người vẫn có thể đọc và viết trong không gian đó. Máy tính của không gian đó được giữ trong 7 ngày, sau đó được giải phóng và xóa dữ liệu. Việc thanh toán sẽ đưa không gian làm việc trở lại, trên một máy tính mới nếu máy tính cũ đã được giải phóng.",
              "**Thay đổi giá.** Chúng tôi có thể thay đổi giá cho khách hàng mới bất cứ lúc nào. Giá của một gói bạn đã có chỉ thay đổi do thuế mới, kể từ lần gia hạn tiếp theo của gói, với thông báo trước ít nhất 30 ngày.",
              "**Sử dụng hợp lý.** Một số tính năng chạy trên các dịch vụ AI mà chúng tôi cung cấp mà không thu thêm phí, chẳng hạn như chọn agent nào trả lời, đánh giá bộ nhớ và hành động, và tìm vị trí cần nhấp trên màn hình. Chúng tôi có thể giới hạn các tính năng đó đối với một không gian làm việc có mức sử dụng cao hơn nhiều so với mức bình thường.",
              "**Ngân sách.** Ngân sách đặt cho mỗi không gian làm việc và mỗi agent sẽ dừng việc sử dụng mô hình của agent khi đạt tới ngân sách. Ngân sách là một phần của Dịch vụ, không phải là khiếm khuyết của Dịch vụ. Các khoản phí mà một nhà cung cấp thu đối với khóa hoặc gói AI riêng của bạn là vấn đề giữa bạn và nhà cung cấp đó.",
            ],
          },
        ],
      },
      {
        id: "ip",
        heading: "11. Sở hữu trí tuệ và phản hồi",
        blocks: [
          "Ngoại trừ Nội dung không gian làm việc của bạn, chúng tôi và các bên cấp phép của chúng tôi giữ mọi quyền, quyền sở hữu và lợi ích đối với Dịch vụ, bao gồm phần mềm, thiết kế và tên cùng các nhãn hiệu agentes.chat. Phản hồi mà bạn chọn gửi cho chúng tôi có thể được sử dụng mà không phát sinh nghĩa vụ đối với bạn.",
        ],
      },
      {
        id: "termination",
        heading: "12. Thời hạn và chấm dứt",
        blocks: [
          "Bạn có thể ngừng sử dụng Dịch vụ và xóa tài khoản của bạn bất cứ lúc nào trong ứng dụng. Tài khoản của bạn bị loại bỏ sau 7 ngày, và bạn có thể khôi phục tài khoản cho đến thời điểm đó. Chúng tôi có thể đình chỉ hoặc chấm dứt quyền truy cập của bạn khi có vi phạm nghiêm trọng các Điều khoản này, khi pháp luật yêu cầu, hoặc với thông báo trước 30 ngày nếu chúng tôi ngừng cung cấp Dịch vụ. Khi chúng tôi chấm dứt Dịch vụ vì các lý do khác ngoài vi phạm của bạn, chúng tôi sẽ cho phép bạn xuất Nội dung không gian làm việc của bạn trong 30 ngày, sau đó xóa nội dung đó như được mô tả trong Chính sách bảo mật. Các mục mà theo bản chất vẫn còn hiệu lực sau khi chấm dứt (bao gồm các Mục 6, 9, 11, 13, 14 và 15) sẽ tiếp tục còn hiệu lực.",
        ],
      },
      {
        id: "disclaimers",
        heading: "13. Tuyên bố miễn trừ trách nhiệm",
        blocks: [
          'Dịch vụ, bao gồm mọi thứ agent tạo ra và thực hiện, được cung cấp "nguyên trạng" và "theo tình trạng sẵn có". Chúng tôi không bảo đảm rằng Dịch vụ hoặc agent sẽ không bị gián đoạn, không có lỗi, chính xác hoặc phù hợp với mục đích của bạn. Trong phạm vi tối đa pháp luật cho phép, chúng tôi từ chối mọi bảo đảm ngụ ý, bao gồm khả năng thương mại, tính phù hợp cho một mục đích cụ thể và việc không xâm phạm quyền.',
        ],
      },
      {
        id: "liability",
        heading: "14. Giới hạn trách nhiệm",
        blocks: [
          "Trong phạm vi tối đa pháp luật cho phép, không bên nào chịu trách nhiệm về các thiệt hại gián tiếp, ngẫu nhiên, đặc biệt, hệ quả hoặc mang tính trừng phạt, hoặc về lợi nhuận, doanh thu hoặc dữ liệu bị mất. Trong cùng phạm vi đó, tổng trách nhiệm của chúng tôi phát sinh từ Dịch vụ được giới hạn ở số tiền bạn đã trả cho chúng tôi trong mười hai tháng trước sự kiện làm phát sinh khiếu nại (hoặc 100 USD nếu bạn không trả khoản nào). Các giới hạn này không áp dụng đối với nghĩa vụ thanh toán của bạn, vi phạm Mục 5 của bạn, hoặc trách nhiệm không thể bị giới hạn theo pháp luật.",
        ],
      },
      {
        id: "indemnification",
        heading: "15. Bồi thường",
        blocks: [
          "Bạn sẽ bảo vệ và bồi thường cho chúng tôi đối với các khiếu nại của bên thứ ba phát sinh từ Nội dung không gian làm việc của bạn, từ những việc agent của bạn đã làm trong phạm vi quyền bạn cấp cho chúng, hoặc từ việc bạn vi phạm Mục 5.",
        ],
      },
      {
        id: "law",
        heading: "16. Luật áp dụng",
        blocks: [
          "Các Điều khoản này, và mọi giao dịch mua thực hiện theo các Điều khoản này, chịu sự điều chỉnh của pháp luật Hoa Kỳ và Bang Delaware, không bao gồm các quy tắc xung đột pháp luật, và các bên chấp nhận thẩm quyền xét xử độc quyền của các tòa án bang và liên bang đặt tại Delaware.",
        ],
      },
      {
        id: "changes",
        heading: "17. Thay đổi đối với các Điều khoản này",
        blocks: [
          "Chúng tôi có thể cập nhật các Điều khoản này. Các thay đổi quan trọng sẽ được thông báo qua email hoặc trong ứng dụng ít nhất 14 ngày trước khi có hiệu lực. Việc tiếp tục sử dụng sau ngày có hiệu lực có nghĩa là chấp nhận. Phiên bản hiện tại luôn nằm tại trang này. Nếu một bản dịch và bản tiếng Anh khác nhau, bản tiếng Anh được ưu tiên áp dụng, trừ khi pháp luật yêu cầu khác.",
        ],
      },
      {
        id: "contact",
        heading: "18. Liên hệ",
        blocks: [
          "AGENTESCHAT, LLC, hoạt động kinh doanh dưới tên agentes.chat. Thông báo: 2810 North Church Street, Ste 91038, Wilmington, DE 19802, USA · legal@agentes.chat · Hỗ trợ về Dịch vụ: support@agentes.chat · Mọi vấn đề khác: hello@agentes.chat",
        ],
      },
    ],
  },
  privacy: {
    title: "Chính sách bảo mật",
    summary:
      "Những gì chúng tôi thu thập, agent gửi dữ liệu đi đâu, ai có thể xem không gian làm việc của bạn, và các quyền của bạn.",
    courtesy:
      "Đây là bản dịch tham khảo không chính thức. Nếu có khác biệt so với bản tiếng Anh, bản tiếng Anh được ưu tiên áp dụng.",
    updated: "2026-11-20",
    sections: [
      {
        id: "overview",
        heading: "1. Tổng quan",
        blocks: [
          'AGENTESCHAT, LLC, một công ty trách nhiệm hữu hạn tại Delaware hoạt động kinh doanh dưới tên agentes.chat (gọi là "agentes.chat", "chúng tôi"), vận hành agentes.chat: một không gian làm việc nơi mọi người và các agent AI cùng làm việc, có sẵn trên web, dưới dạng ứng dụng Mac và ứng dụng điện thoại (gọi là "Dịch vụ"). Chính sách này phân biệt ba vai trò:',
          {
            list: [
              "Đối với **dữ liệu tài khoản**, thông tin mọi người cung cấp cho chúng tôi để tạo và sử dụng một tài khoản, chúng tôi là bên kiểm soát dữ liệu.",
              "Đối với **Nội dung không gian làm việc**, mọi thứ mà mọi người và agent của một không gian làm việc đưa vào hoặc tạo ra trong không gian đó, chúng tôi là bên xử lý dữ liệu hành động theo chỉ dẫn của không gian làm việc. Không gian làm việc là bên kiểm soát dữ liệu, có nghĩa là cá nhân hoặc tổ chức đã tạo ra không gian đó hoặc không gian đó được tạo thay mặt cho họ.",
              "Đối với một số ít trường hợp trong Mục 6 khi chúng tôi hành động vì chính mình (tin cậy và an toàn, tính bảo mật của Dịch vụ, và những gì pháp luật yêu cầu ở chúng tôi), chúng tôi là bên kiểm soát dữ liệu đối với dữ liệu cá nhân trong Nội dung không gian làm việc mà chúng tôi đọc cho mục đích đó.",
            ],
          },
        ],
      },
      {
        id: "data-we-collect",
        heading: "2. Dữ liệu chúng tôi thu thập với tư cách bên kiểm soát",
        blocks: [
          {
            list: [
              "**Dữ liệu tài khoản:** tên, địa chỉ email, hàm băm mật khẩu, ảnh hồ sơ, ngôn ngữ và múi giờ. Nếu bạn đăng nhập bằng Google, Apple hoặc GitHub, chúng tôi nhận được tên, địa chỉ email và mã định danh tài khoản của bạn từ nhà cung cấp đó, không bao giờ nhận mật khẩu của bạn tại đó.",
              "**Dữ liệu không gian làm việc:** tên của không gian làm việc, các thành viên, vai trò và lời mời.",
              "**Yêu cầu hỗ trợ:** những gì bạn gửi cho chúng tôi khi bạn yêu cầu trợ giúp: lời của bạn, nội dung bạn báo cáo và những gì nội dung đó nói, màn hình bạn đang ở, và bất kỳ hình ảnh hoặc video nào bạn đính kèm.",
              "**Dữ liệu thanh toán:** đối với một không gian làm việc có gói agentes.chat, tên, địa chỉ email, địa chỉ thanh toán và mã số thuế của người thanh toán, gói dịch vụ, cùng các hóa đơn và khoản thanh toán của gói đó. Thanh toán được xử lý bởi Stripe, đơn vị xử lý thông tin thẻ: thông tin thẻ không bao giờ đến tay chúng tôi.",
              "**Dữ liệu sử dụng và nhật ký:** địa chỉ IP, trình duyệt và thiết bị, các phiên đăng nhập, sự kiện bảo mật, yêu cầu API, và bản ghi của mỗi lần gọi mô hình (mô hình, số token và chi phí, cùng không gian làm việc và agent mà lần gọi đó thuộc về), mà chúng tôi giữ để thực thi ngân sách và hiển thị mức sử dụng. Khi có sự cố, chúng tôi ghi lại lỗi, không kèm nội dung tin nhắn, để khắc phục. Chúng tôi cũng giữ bản ghi của mỗi lần nhóm của chúng tôi hoặc một trợ lý AI làm việc cho nhóm của chúng tôi đọc Nội dung không gian làm việc bằng các công cụ hoặc bảng điều khiển mà Mục 6 mô tả: ai hoặc công cụ nào đã đọc, đọc mục nào, khi nào và vì sao, không bao giờ ghi nội dung tự thân.",
              "**Thiết bị:** đối với ứng dụng điện thoại, mã thông báo đẩy của mỗi thiết bị bạn đăng nhập. Đối với máy tính đã kết nối và ứng dụng Mac, tên máy tính, hệ điều hành và phiên bản ứng dụng.",
              "**Danh sách chờ:** địa chỉ email và ngôn ngữ bạn cung cấp cho chúng tôi trên agentes.chat, và việc bạn đã xác nhận địa chỉ đó hay chưa.",
              "**Phân tích trang web:** trên agentes.chat (trang web công khai, không phải không gian làm việc), các trang đã xem, trang web giới thiệu, loại thiết bị và vị trí gần đúng suy ra từ địa chỉ IP, được thu thập bằng Himetrica.",
            ],
          },
        ],
      },
      {
        id: "how-we-use",
        heading: "3. Cách chúng tôi sử dụng dữ liệu tài khoản",
        blocks: [
          "Để cung cấp và bảo mật Dịch vụ (bao gồm phát hiện và ngăn chặn lạm dụng), xuất hóa đơn cho các gói, áp dụng ngân sách và giới hạn, trả lời các yêu cầu hỗ trợ, đáp ứng các nghĩa vụ pháp lý, và gửi các tin nhắn dịch vụ chẳng hạn như xác nhận email, lời mời, đặt lại mật khẩu, yêu cầu phê duyệt và các thông báo bạn đã bật. Chúng tôi chỉ gửi email cho danh sách chờ để xác nhận địa chỉ và để mời bạn.",
          "Để trả lời các yêu cầu hỗ trợ và để xem xét các lỗi cùng lạm dụng bị nghi ngờ, chúng tôi sử dụng các trợ lý AI làm việc cho nhóm của chúng tôi. Chúng suy nghĩ bằng các mô hình Claude. Nhà cung cấp các mô hình đó là Anthropic, công ty tạo ra Claude: các trợ lý tiếp cận nhà cung cấp đó thông qua API của họ, theo điều khoản thương mại của họ, vốn không cho phép họ huấn luyện mô hình của mình trên những gì họ nhận được. Chúng đọc các bản ghi tài khoản và sử dụng: mã định danh, trạng thái và thời gian, văn bản của các lỗi mà hệ thống của chúng tôi ghi lại (với thông tin đăng nhập và địa chỉ đã được che), và một cái tên khi một trường hợp cần đến. Chúng có thể tra cứu một lỗi như vậy trên web. Một người trong nhóm của chúng tôi cũng có thể xem xét một trường hợp bằng một công cụ AI mà họ tự sử dụng, công cụ này cũng suy nghĩ bằng các mô hình Claude: công cụ đó nhận được những gì người đó đọc, và điều đó có thể bao gồm địa chỉ email của một người.",
          "Khi một không gian làm việc được tạo, chúng tôi kiểm tra việc đăng ký của nó về lạm dụng: tên miền của email được gửi tới cơ quan đăng ký của tên miền đó, mạng của lần đăng nhập đầu tiên (không bao giờ là địa chỉ) được gửi tới Team Cymru, và tên của không gian làm việc được gửi tới TypeSafe. Trên các trang đăng ký và đăng nhập, một kiểm tra bot do nhà cung cấp mạng của chúng tôi vận hành sẽ đọc các tín hiệu từ trình duyệt của bạn.",
          "Chúng tôi không bán dữ liệu cá nhân, không sử dụng Nội dung không gian làm việc để huấn luyện các mô hình học máy, và không cho phép các bên xử lý phụ của chúng tôi làm như vậy.",
        ],
      },
      {
        id: "workspace-content",
        heading: "4. Nội dung không gian làm việc, được xử lý thay mặt cho các không gian làm việc",
        blocks: [
          "Nội dung không gian làm việc bao gồm tin nhắn trong các kênh, thread và tin nhắn riêng, tệp trong Drive và các trang wiki. Nội dung này cũng bao gồm các tác vụ, quy trình định kỳ, sự kiện lịch và phê duyệt, chỉ dẫn, cài đặt và bộ nhớ của agent, những gì agent viết và làm, và dữ liệu agent đọc thông qua các trình kết nối, cơ sở dữ liệu và máy tính mà không gian làm việc kết nối. Chúng tôi chỉ xử lý nội dung đó để vận hành không gian làm việc và agent của nó theo cách không gian làm việc cấu hình, để hiển thị nội dung đó cho các thành viên của không gian làm việc, để gửi các thông báo họ yêu cầu, để cung cấp hỗ trợ, để duy trì Dịch vụ hoạt động và an toàn, và trong các trường hợp của Mục 6 khi chúng tôi hành động vì chính mình.",
          "Nội dung không gian làm việc thuộc về không gian làm việc: các thành viên xem những gì kênh và quyền của không gian đó cho phép, và Chủ sở hữu cùng Quản trị viên của không gian đó quản lý nội dung đó. Chủ sở hữu và quản trị viên của không gian làm việc có thể xem mọi kênh, tác vụ và trang wiki, kể cả các mục riêng tư. Họ không thể đọc tin nhắn riêng giữa những người khác. Tin nhắn bạn đã đăng vẫn ở trong không gian làm việc sau khi bạn rời khỏi nó hoặc xóa tài khoản của bạn, trừ khi không gian làm việc xóa chúng.",
        ],
      },
      {
        id: "agents",
        heading: "5. Cách agent xử lý Nội dung không gian làm việc",
        blocks: [
          "Agent là các mô hình AI đọc và hành động bên trong không gian làm việc. Nội dung không gian làm việc rời khỏi máy chủ của chúng tôi trong các trường hợp sau. Các công ty xử lý nội dung đó thay cho chúng tôi được liệt kê trong Mục 9.",
          {
            list: [
              "**Giữa các thiết bị và máy chủ của chúng tôi.** Mọi thứ được gửi giữa máy chủ của chúng tôi và các trình duyệt, ứng dụng và máy tính kết nối tới chúng, bao gồm Nội dung không gian làm việc, đều đi qua nhà cung cấp mạng của chúng tôi, đơn vị bảo vệ Dịch vụ khỏi các cuộc tấn công. Để làm điều đó, nhà cung cấp mạng giải mã lưu lượng này tại trung tâm dữ liệu gần nhất với mỗi thiết bị, và xử lý nó thay mặt cho chúng tôi.",
              "**Trả lời.** Khi một agent làm việc, agent gửi ngữ cảnh nó cần (ngữ cảnh của không gian làm việc, chỉ dẫn của agent, cuộc trò chuyện, bộ nhớ liên quan và kết quả của các công cụ của nó) tới nhà cung cấp mô hình được chọn cho agent đó. Với một khóa API mà không gian làm việc đã thêm, lần gọi được thực hiện dưới tài khoản và thỏa thuận riêng của không gian làm việc với nhà cung cấp đó. Một số nhà cung cấp chuyển tiếp lần gọi tới công ty tạo ra hoặc lưu trữ mô hình, công ty này sau đó cũng xử lý lần gọi theo điều khoản của nhà cung cấp đó. Với một gói AI, chẳng hạn như Claude hoặc ChatGPT, được kết nối tới một agent, agent làm việc dưới tài khoản của người đã kết nối gói đó và theo điều khoản của nhà cung cấp.",
              "**Quyết định ai trả lời.** Một mô hình định tuyến đọc một tin nhắn mới, tên và vai trò của các agent trong không gian làm việc, và cuộc trò chuyện gần đây để quyết định agent nào, nếu có, nên trả lời. Mô hình này chạy tại TypeSafe hoặc, như một phương án dự phòng, tại nhà cung cấp mô hình của không gian làm việc. Việc định tuyến không bao giờ cấp cho agent bất kỳ quyền nào.",
              "**Bộ nhớ.** Agent giữ bộ nhớ từ các cuộc trò chuyện (tóm tắt, sự kiện và bài học) để chúng cải thiện theo thời gian. Một số đánh giá về bộ nhớ (việc một điều gì đó có đáng giữ hay không, hoặc có mâu thuẫn với những gì agent đã biết hay không) do TypeSafe thực hiện. Bộ nhớ có thể được xem và loại bỏ trong trang của agent, và nó bị xóa cùng với không gian làm việc.",
              "**Tìm kiếm.** Để tìm các tin nhắn và tài liệu liên quan, văn bản có thể được chuyển thành các vector (embedding) bởi DeepInfra, Inc.",
              "**Trình kết nối.** Khi không gian làm việc kết nối một dịch vụ (chẳng hạn như GitHub, Google, Linear, Sentry, một hộp thư email hoặc bất kỳ máy chủ MCP nào), chúng tôi lưu trữ mã truy cập của dịch vụ đó dưới dạng đã mã hóa và chỉ đọc hoặc ghi vào dịch vụ đó trong phạm vi các quyền mà không gian làm việc cấp cho mỗi agent. Dịch vụ đã kết nối xử lý dữ liệu đó theo điều khoản riêng của mình. Các kết nối tới hộp thư Gmail và Outlook, và tới Google Drive, Google Calendar, Google Sheets, Google Docs, Slack, Microsoft Teams, OneDrive, HubSpot, Salesforce, Zendesk, Asana, Figma, Intercom, Dropbox, Square, Instagram, Facebook, LinkedIn, YouTube, Pinterest, Reddit và WhatsApp, đều đi qua Composio, đơn vị xử lý những gì agent đọc và viết ở đó.",
              "**Cơ sở dữ liệu.** Các kết nối cơ sở dữ liệu là chỉ đọc. Thông tin đăng nhập được lưu trữ dưới dạng đã mã hóa và mỗi truy vấn được kiểm tra trước khi chạy.",
              "**Máy tính đã kết nối.** Khi một người kết nối một máy tính, agent có thể chạy lệnh và sử dụng trình duyệt ở đó, trong phạm vi các thư mục và quyền được đặt trên máy tính đó. Hình ảnh trực tiếp của trình duyệt của agent đi qua nhà cung cấp mạng của chúng tôi và qua bộ nhớ của máy chủ của chúng tôi, và không được ghi lại. Một bản tóm tắt các bước agent đã thực hiện (chẳng hạn như các địa chỉ đã truy cập và các hành động) được giữ cùng với công việc của agent để nhóm có thể xem agent đã làm gì.",
              "**Máy tính của không gian làm việc.** Trên agentes.chat Cloud, agent của một không gian làm việc làm việc trên một máy tính chúng tôi vận hành cho không gian đó, trên máy chủ của chúng tôi hoặc của một nhà cung cấp dịch vụ lưu trữ, tại Liên minh Châu Âu hoặc Hoa Kỳ. Chúng tôi đếm lượng dữ liệu mà trình duyệt, công cụ AI và các chương trình khác của mỗi agent gửi và nhận ở đó, theo từng ngày. Lưu lượng của trình duyệt và chương trình của agent ở đó đi ra qua các địa chỉ chúng tôi thuê từ một nhà cung cấp proxy, đơn vị chuyên chở lưu lượng đó. Máy tính bị xóa dữ liệu sau khi gói agentes.chat của không gian làm việc kết thúc, như Điều khoản sử dụng mô tả.",
              "**Hỗ trợ, lỗi và an toàn.** Khi chúng tôi xem xét một yêu cầu hỗ trợ, một lỗi hoặc lạm dụng bị nghi ngờ (Mục 6), một trợ lý AI làm việc cho nhóm của chúng tôi có thể đọc mục đang được đề cập. Mục đó sau đó được gửi tới nhà cung cấp mô hình của trợ lý, công ty tạo ra Claude, đơn vị xử lý mục đó tại Hoa Kỳ, và tại các quốc gia khác khi họ định tuyến một yêu cầu tới đó, theo thỏa thuận kinh doanh của chúng tôi với họ: họ không được huấn luyện trên mục đó, và họ xóa mục đó trong vòng 30 ngày, ngoại trừ những gì kiểm tra lạm dụng của chính họ đánh dấu, mà họ có thể giữ tới hai năm. Khi một người trong nhóm của chúng tôi đọc mục đó bằng một công cụ AI họ tự sử dụng, mục đó đi tới cùng nhà cung cấp đó thông qua công cụ đó.",
              "**Lưu trữ, email và thông báo.** Tệp đã tải lên và các bản sao lưu được giữ tại các nhà cung cấp lưu trữ của chúng tôi. Email và thông báo điện thoại có trích dẫn một tin nhắn đi qua nhà cung cấp email của chúng tôi và qua Apple và Google. Một yêu cầu hỗ trợ bạn gửi cho chúng tôi, kèm những gì bạn đính kèm, đến nhóm của chúng tôi qua email.",
              "**Kiểm tra lạm dụng.** Một bộ đánh giá tự động chạy tại TypeSafe đọc một mẫu những gì agent đã làm. Chúng tôi chỉ giữ kết luận của bộ đánh giá đó.",
              "**Các dịch vụ AI khác chúng tôi cung cấp.** TypeSafe cũng đánh giá việc một hành động của agent có nên chờ một người hay không, chọn một mô hình hoặc công cụ cho một tác vụ, và đọc văn bản hoặc hình ảnh của một màn hình để tìm vị trí cần nhấp khi agent sử dụng một máy tính.",
              "**Tìm kiếm trên web.** Khi một agent tìm kiếm trên web, các từ nó tìm kiếm được gửi tới một công cụ tìm kiếm: DuckDuckGo từ máy chủ của chúng tôi, hoặc công cụ mà agent mở trong trình duyệt riêng của nó. Khi agent mở một trang, trang web đó thấy địa chỉ nó yêu cầu, như với bất kỳ khách truy cập nào.",
              "**GIF.** Khi một agent hoặc một người tìm kiếm một GIF, các từ tìm kiếm được gửi tới nhà cung cấp GIF, GIPHY.",
            ],
          },
          "Các hành động khó hoàn tác (chẳng hạn như hợp nhất mã, triển khai hoặc gửi thay mặt cho một người) trở thành một yêu cầu phê duyệt gửi tới một người trước khi chúng xảy ra, trừ khi không gian làm việc đã đặt agent đó ở chế độ hành động mà không cần hỏi. Văn bản đến từ bên ngoài không gian làm việc (trang web, email, tệp) được đánh dấu là không đáng tin cậy trước khi agent đọc nó.",
        ],
      },
      {
        id: "staff-access",
        heading: "6. Khi nào nhân viên agentes.chat có thể xem Nội dung không gian làm việc",
        blocks: [
          "Chúng tôi không duyệt xem các không gian làm việc. Ngoài việc vận hành không gian làm việc của bạn mà các Mục 4 và 5 mô tả, nhóm của chúng tôi và các trợ lý AI làm việc cho nhóm của chúng tôi chỉ đọc Nội dung không gian làm việc:",
          {
            list: [
              "**Theo yêu cầu của bạn,** để trợ giúp với một yêu cầu hỗ trợ mà một thành viên của không gian làm việc của bạn đã gửi cho chúng tôi: từ ứng dụng, từ địa chỉ email của tài khoản của họ, hoặc bằng cách khác sau khi chúng tôi xác nhận đó là của họ. Chúng tôi đọc nội dung mà yêu cầu đề cập và không đọc quá những gì thành viên đã yêu cầu có thể xem. Khi trợ lý AI của chúng tôi trả lời, nó chỉ trả lời tại địa chỉ của tài khoản của thành viên đó. Đối với trường hợp này, một tin nhắn riêng chỉ được đọc khi một người trong cuộc trò chuyện đó đã yêu cầu.",
              "**Để khắc phục một lỗi,** khi một điều gì đó trong Dịch vụ bị lỗi hoặc bị kẹt, chẳng hạn như công việc của một agent kết thúc bằng lỗi hoặc ngừng tiến triển. Chúng tôi đọc nội dung liên quan tới lỗi đó, và không bao giờ đọc một tin nhắn riêng.",
              "**Vì tin cậy và an toàn,** để phát hiện và điều tra lạm dụng, gian lận, nội dung bất hợp pháp bị nghi ngờ hoặc một mối đe dọa đối với tính bảo mật của Dịch vụ hoặc của người khác, hoặc để thực thi Điều khoản sử dụng của chúng tôi. Chúng tôi có thể làm điều này mà không thông báo cho không gian làm việc vào thời điểm đó. Nếu chúng tôi hạn chế một không gian làm việc hoặc một tài khoản, chúng tôi sẽ nói lý do và cách khiếu nại, trừ khi lệnh của một cơ quan có thẩm quyền cấm chúng tôi nói như vậy. Đối với trường hợp này, trong một cuộc trò chuyện riêng chúng tôi chỉ đọc những gì đã được nói với một agent hoặc bởi một agent, không bao giờ đọc tin nhắn giữa mọi người với nhau, trừ khi một người trong cuộc trò chuyện đó đã báo cáo chúng hoặc pháp luật yêu cầu.",
              "**Khi pháp luật yêu cầu.**",
            ],
          },
          "Theo yêu cầu của bạn và để khắc phục một lỗi, chúng tôi hành động theo chỉ dẫn của không gian làm việc. Vì tin cậy và an toàn, chúng tôi dựa vào lợi ích hợp pháp của mình trong việc giữ Dịch vụ và người khác an toàn (Điều 6(1)(f) GDPR và Điều 7, IX LGPD) và, khi pháp luật yêu cầu, dựa vào nghĩa vụ pháp lý đó. Bạn có thể phản đối như các Mục 11 và 12 mô tả.",
          "Nhóm của chúng tôi và các trợ lý AI làm việc cho nhóm đọc bằng các công cụ cung cấp từng mục một. Mỗi lần đọc thực hiện bằng các công cụ đó đều được thực hiện vì một trong các lý do này và được ghi lại trước khi nó xảy ra: ai hoặc công cụ nào đã đọc, đọc mục nào, khi nào và vì sao. Những người vận hành agentes.chat nhận được các bản ghi đó mỗi buổi sáng. Một lần đọc những gì không gian làm việc của bạn đã viết, thực hiện bằng các công cụ đó theo yêu cầu của bạn hoặc để khắc phục một lỗi, cũng xuất hiện trong nhật ký kiểm tra của không gian làm việc của bạn: mục đó, lý do thuộc nhóm nào trong các lý do này, và, đối với một yêu cầu, là của ai (đối với một tin nhắn riêng, chỉ ghi việc một lần đọc đã xảy ra và theo yêu cầu của ai). Một lần đọc thực hiện bằng các công cụ đó vì tin cậy và an toàn được ghi ở đó khi cuộc điều tra kết thúc, và chậm nhất bảy ngày sau lần đọc, trừ khi pháp luật cấm chúng tôi nói như vậy. Khi các công cụ đó cung cấp một cái tên hoặc văn bản của một lỗi từ các bản ghi tài khoản và sử dụng mà Mục 3 mô tả, lần đọc đó chỉ được ghi lại ở phía chúng tôi. Một người trong nhóm của chúng tôi cũng có thể mở, trong bảng điều khiển vận hành của chúng tôi và vì một lý do đã được ghi lại, những gì kiểm tra lạm dụng của chúng tôi đã đánh giá trong một không gian làm việc. Lần đọc đó được ghi lại ở phía chúng tôi.",
          "Những người vận hành hạ tầng của chúng tôi, và các công cụ họ dùng để vận hành hạ tầng đó, có thể tiếp cận các máy chủ và cơ sở dữ liệu lưu trữ Nội dung không gian làm việc. Họ chỉ sử dụng quyền truy cập đó để duy trì Dịch vụ hoạt động, chẳng hạn như khôi phục các bản sao lưu, hoặc để đáp ứng một nghĩa vụ pháp lý. Không con đường nào trong số này được sử dụng để xây dựng hồ sơ, quảng cáo hoặc dữ liệu huấn luyện.",
        ],
      },
      {
        id: "retention",
        heading: "7. Thời gian lưu giữ",
        blocks: [
          {
            list: [
              "**Dữ liệu tài khoản:** trong suốt thời gian tồn tại của tài khoản. Khi bạn xóa tài khoản của bạn trong ứng dụng, tài khoản đó bị đăng xuất ở mọi nơi cùng một lúc và bị loại bỏ sau 7 ngày, trừ khi bạn khôi phục trước thời điểm đó, và rời khỏi các bản sao lưu của chúng tôi trong vòng 30 ngày sau đó, ngoại trừ các bản ghi chúng tôi phải giữ theo pháp luật. Bất kỳ không gian làm việc nào mà bạn là thành viên duy nhất sẽ đóng cùng lúc đó, và nội dung của nó bị xóa sau 7 ngày như được mô tả tiếp theo. Các không gian làm việc bạn đã tham gia giữ tên và địa chỉ email của bạn trong nhật ký kiểm tra của chúng chừng nào mỗi không gian đó còn tồn tại.",
              "**Nội dung không gian làm việc:** trong suốt thời gian tồn tại của không gian làm việc, và sớm hơn khi không gian làm việc xóa nội dung cụ thể. Khi gói agentes.chat của một không gian làm việc kết thúc, nội dung của nó vẫn sẵn có trong 90 ngày và sau đó bị xóa. Khi một Chủ sở hữu xóa một không gian làm việc, nó đóng đối với mọi người cùng một lúc và nội dung của nó bị xóa sau 7 ngày, trừ khi một Chủ sở hữu khôi phục trước thời điểm đó, và rời khỏi các bản sao lưu của chúng tôi trong vòng 30 ngày sau đó, ngoại trừ nội dung chúng tôi phải giữ theo pháp luật hoặc làm bản ghi về lạm dụng (bên dưới), và ngoại trừ các trích đoạn chúng tôi đã đọc để hỗ trợ hoặc điều tra, vốn tuân theo dòng riêng của chúng bên dưới.",
              "**Nhật ký:** nhật ký yêu cầu và bảo mật tới 90 ngày. Bản ghi sử dụng mô hình (số token và chi phí) trong suốt thời gian tồn tại của không gian làm việc, vì ngân sách và báo cáo sử dụng phụ thuộc vào chúng.",
              "**Yêu cầu hỗ trợ:** những gì bạn gửi cho chúng tôi khi yêu cầu trợ giúp, trong 90 ngày. Email mà yêu cầu đó đến vẫn ở trong hộp thư của nhóm chúng tôi trong 90 ngày. Hình ảnh và video trong 30 ngày (không tính bản sao bên trong email đó).",
              "**Hỗ trợ và điều tra:** những gì chúng tôi đọc để trả lời một yêu cầu hỗ trợ hoặc để xem xét một lỗi hoặc lạm dụng bị nghi ngờ, và bất kỳ bản sao nào của nó trong luồng công việc của chúng tôi, tới 90 ngày sau khi chúng tôi đọc nó, ngay cả khi không gian làm việc xóa nó sớm hơn, trừ khi nó là một bản ghi về lạm dụng (bên dưới). Kết luận của chúng tôi về một trường hợp, vốn không chứa nội dung nào, vẫn ở cùng bản ghi của trường hợp đó. Bản ghi của chúng tôi về mỗi lần đọc thực hiện bằng các công cụ mà Mục 6 mô tả (ai, khi nào, mục nào và vì sao, không bao giờ là nội dung) trong một năm.",
              "**Dữ liệu thanh toán:** trong khi bạn thanh toán cho một không gian làm việc, và sau đó chừng nào luật thuế và kế toán yêu cầu.",
              "**Danh sách chờ:** cho đến khi bạn được mời và trong 12 tháng sau đó, hoặc cho đến khi bạn yêu cầu chúng tôi loại bỏ bạn.",
              "**Các tài khoản chúng tôi đình chỉ hoặc đóng vì lạm dụng:** chúng tôi có thể giữ các bản ghi của tài khoản và của hành vi lạm dụng vượt quá các thời hạn này, bao gồm sau khi việc xóa được yêu cầu, chừng nào cần thiết để thiết lập, thực hiện hoặc bảo vệ các khiếu nại pháp lý, để đáp ứng các nghĩa vụ pháp lý, và để ngăn cùng những người đó lạm dụng Dịch vụ lần nữa, theo Điều 17(3)(b) và (e) và Điều 6(1)(f) của GDPR và các Điều 7(VI), 7(IX) và 16(I) của LGPD.",
            ],
          },
        ],
      },
      {
        id: "security",
        heading: "8. Bảo mật",
        blocks: [
          "Dữ liệu được mã hóa khi truyền (TLS). Khóa của nhà cung cấp mô hình, mã của trình kết nối và thông tin đăng nhập cơ sở dữ liệu được mã hóa bằng mã hóa phong bì theo từng không gian làm việc và không bao giờ được gửi trở lại trình duyệt hoặc các ứng dụng. Máy tính của các không gian làm việc trên các máy chủ chúng tôi tự vận hành, và các bản sao lưu tệp của chúng, được mã hóa khi lưu trữ. Quyền truy cập vào hệ thống sản xuất bị hạn chế và được ghi nhật ký. Nếu chúng tôi biết về một vụ vi phạm dữ liệu cá nhân, chúng tôi sẽ thông báo cho các không gian làm việc bị ảnh hưởng không chậm trễ quá mức và trong các thời hạn mà GDPR và LGPD yêu cầu.",
        ],
      },
      {
        id: "transfers",
        heading: "9. Chuyển dữ liệu quốc tế",
        blocks: [
          "Ứng dụng của chúng tôi và cơ sở dữ liệu của nó chạy tại Hoa Kỳ, và các nhà cung cấp được nêu trong chính sách này xử lý dữ liệu tại Hoa Kỳ, ngoại trừ các nhà cung cấp mô hình và dịch vụ đã kết nối mà một không gian làm việc lựa chọn, và các công ty mà họ chuyển tiếp các lần gọi tới, vốn có thể xử lý dữ liệu tại các quốc gia khác theo điều khoản riêng của họ, và ngoại trừ DuckDuckGo, GIPHY, DeepInfra, Inc., Team Cymru, cơ quan đăng ký của tên miền của một email, nhà cung cấp proxy của chúng tôi, dịch vụ đẩy của nhà sản xuất trình duyệt của bạn và các nhà cung cấp lưu trữ của chúng tôi, mà chúng tôi không nêu vị trí của họ. Nhà cung cấp mô hình của các trợ lý AI của chúng tôi (Mục 5) xử lý dữ liệu tại Hoa Kỳ, và tại các quốc gia khác khi họ định tuyến một yêu cầu tới đó. Máy tính của các không gian làm việc chạy tại Hoa Kỳ và Liên minh Châu Âu. Nhà cung cấp mạng của chúng tôi xử lý lưu lượng tại trung tâm dữ liệu gần nhất với mỗi thiết bị, tại Hoa Kỳ hoặc nơi khác.",
          "**Bên xử lý phụ.** Các công ty này xử lý Nội dung không gian làm việc thay cho chúng tôi:",
          {
            list: [
              "**Nhà cung cấp mạng của chúng tôi:** mạng và bảo vệ chống lại các cuộc tấn công. Vị trí: Hoa Kỳ và trung tâm dữ liệu gần nhất với mỗi thiết bị của họ.",
              "**Các nhà cung cấp dịch vụ lưu trữ của chúng tôi:** lưu trữ ứng dụng và cơ sở dữ liệu của nó, và máy tính của các không gian làm việc. Vị trí: Hoa Kỳ đối với ứng dụng và cơ sở dữ liệu của nó, Hoa Kỳ và Liên minh Châu Âu đối với máy tính của các không gian làm việc.",
              "**Các nhà cung cấp lưu trữ tệp và lưu trữ bản sao lưu của chúng tôi:** lưu trữ các tệp đã tải lên và các bản sao lưu cơ sở dữ liệu, và các bản sao lưu đã mã hóa của máy tính của các không gian làm việc.",
              "**MillionSend, một dịch vụ của CODARI GLOBAL, LLC:** gửi và nhận email, và hộp thư của nhóm chúng tôi, nơi các yêu cầu hỗ trợ đến. Vị trí: Hoa Kỳ.",
              "**TypeSafe:** các dịch vụ AI chúng tôi cung cấp: chọn agent nào trả lời, đánh giá bộ nhớ và hành động, đọc một màn hình, kiểm tra lạm dụng. Vị trí: Hoa Kỳ.",
              "**DeepInfra, Inc.:** tìm kiếm (embedding văn bản).",
              "**Composio:** các kết nối tới các dịch vụ được liệt kê trong Mục 5. Vị trí: Hoa Kỳ.",
              "**Apple Inc., Google LLC và dịch vụ đẩy của nhà sản xuất trình duyệt của bạn:** gửi thông báo. Vị trí: Hoa Kỳ đối với Apple và Google.",
              "**Các mô hình AI (Claude):** do Anthropic, công ty tạo ra Claude, cung cấp, cho các trợ lý AI phục vụ hỗ trợ, lỗi và an toàn và cho các công cụ AI mà nhóm của chúng tôi sử dụng. Theo thỏa thuận kinh doanh của chúng tôi, họ không được huấn luyện trên những gì các trợ lý gửi cho họ. Vị trí: Hoa Kỳ, và các quốc gia khác khi họ định tuyến một yêu cầu tới đó.",
            ],
          },
          "Các nhà cung cấp mô hình và dịch vụ mà không gian làm việc của bạn kết nối bằng khóa, gói hoặc tài khoản riêng của mình hoạt động theo thỏa thuận riêng của bạn với họ và không nằm trong danh sách này. Chúng tôi giữ danh sách này luôn cập nhật, và chúng tôi sẽ thông báo về các thay đổi đối với bên xử lý phụ cho các khách hàng có DPA đã ký kết trước khi thay đổi có hiệu lực. Danh sách đầy đủ các công ty, vốn cũng nêu tên nhà cung cấp mạng và các nhà cung cấp dịch vụ lưu trữ cùng lưu trữ tệp của chúng tôi, có sẵn theo yêu cầu tại legal@agentes.chat, kèm Phụ lục xử lý dữ liệu (Mục 13).",
          "**Chuyển dữ liệu quốc tế.** Dữ liệu được chuyển liên tục, chừng nào không gian làm việc hoặc tài khoản còn tồn tại, để cung cấp Dịch vụ. Đối với dữ liệu tài khoản và đối với những gì chúng tôi đọc vì chính mình (Mục 6), bên kiểm soát dữ liệu là AGENTESCHAT, LLC (privacy@agentes.chat). Đối với phần còn lại của Nội dung không gian làm việc, bên kiểm soát là không gian làm việc, và chúng tôi là bên xử lý của nó. Chúng tôi chia sẻ dữ liệu với các bên xử lý phụ được liệt kê ở trên và với các nhà cung cấp được nêu trong chính sách này, mỗi bên cho mục đích được nêu ở đó. Khi dữ liệu cá nhân chịu sự điều chỉnh của GDPR hoặc UK GDPR được chuyển tới một quốc gia thứ ba, chúng tôi dựa vào Điều khoản hợp đồng tiêu chuẩn của Ủy ban Châu Âu và Phụ lục của Vương quốc Anh. Đối với dữ liệu chịu sự điều chỉnh của LGPD, các điều khoản hợp đồng tiêu chuẩn được cơ quan bảo vệ dữ liệu của Brazil phê duyệt (Nghị quyết ANPD 19/2024) nằm trong Phụ lục xử lý dữ liệu của chúng tôi. Mọi không gian làm việc đều có thể yêu cầu phụ lục đó (Mục 13). Phụ lục chứa mọi điều khoản này và các biện pháp bảo mật. Các quyền của bạn và cách thực hiện chúng nằm trong các Mục 11 và 12, bao gồm quyền khiếu nại lên ANPD.",
        ],
      },
      {
        id: "apps",
        heading: "10. Ứng dụng điện thoại và Mac",
        blocks: [
          "Ứng dụng điện thoại gửi thông báo qua Apple và Google. Một thông báo có thể hiển thị tên của người đã viết và phần đầu của tin nhắn, và bạn chọn những thông báo nào bạn nhận. Ứng dụng Mac và các máy tính đã kết nối giữ đăng nhập của chúng trên thiết bị. Việc xóa tài khoản của bạn (cũng có sẵn trong các ứng dụng) sẽ đăng xuất mọi thiết bị.",
        ],
      },
      {
        id: "gdpr",
        heading: "11. Các quyền của bạn theo GDPR",
        blocks: [
          "Nếu bạn ở trong EEA hoặc Vương quốc Anh, bạn có thể yêu cầu truy cập, chỉnh sửa, xóa, hạn chế và chuyển dữ liệu, và phản đối việc xử lý, và bạn có thể khiếu nại lên cơ quan giám sát của bạn. Đối với dữ liệu tài khoản, hãy liên hệ trực tiếp với chúng tôi. Bạn cũng có thể tự sửa hồ sơ của bạn và xóa tài khoản của bạn trong ứng dụng. Đối với dữ liệu cá nhân trong Nội dung không gian làm việc, hãy liên hệ Chủ sở hữu hoặc Quản trị viên của không gian làm việc, bên kiểm soát dữ liệu đó. Chúng tôi sẽ chuyển các yêu cầu chúng tôi nhận được tới không gian làm việc đó và hỗ trợ nó với tư cách bên xử lý. Đối với những gì chúng tôi xử lý với tư cách bên kiểm soát theo Mục 6, hãy viết trực tiếp cho chúng tôi.",
        ],
      },
      {
        id: "lgpd",
        heading: "12. Các quyền của bạn theo LGPD",
        blocks: [
          "Nếu bạn ở Brazil, Lei Geral de Proteção de Dados trao cho bạn các quyền tương ứng: xác nhận việc xử lý, truy cập, sửa chữa, ẩn danh hóa, chặn hoặc xóa, chuyển dữ liệu, thông tin về việc chia sẻ, và rút lại sự đồng ý. Các yêu cầu đi qua cùng các kênh như Mục 11, và bạn có thể khiếu nại lên ANPD. Nhóm bảo mật của chúng tôi, có thể liên hệ tại privacy@agentes.chat, đóng vai trò là đầu mối liên hệ của chúng tôi (encarregado).",
        ],
      },
      {
        id: "dpa",
        heading: "13. Phụ lục xử lý dữ liệu",
        blocks: [
          "Một DPA bao quát việc chúng tôi xử lý Nội dung không gian làm việc, bao gồm Điều khoản hợp đồng tiêu chuẩn và các điều khoản xử lý của LGPD, có sẵn cho mọi không gian làm việc. Hãy yêu cầu tại legal@agentes.chat.",
        ],
      },
      {
        id: "cookies",
        heading: "14. Cookie và lưu trữ cục bộ",
        blocks: [
          "Không gian làm việc chỉ sử dụng các cookie và lưu trữ cục bộ cần thiết để giữ bạn đăng nhập, bảo vệ các biểu mẫu, và ghi nhớ các tùy chọn chẳng hạn như giao diện và ngôn ngữ. Trang web công khai agentes.chat ghi nhớ ngôn ngữ bạn đã chọn và sử dụng phân tích Himetrica (Mục 2). Chúng tôi không sử dụng cookie quảng cáo hoặc theo dõi liên trang.",
          "**Cookie giới thiệu:** khi bạn mở một liên kết giới thiệu tới agentes.chat, dịch vụ thanh toán của chúng tôi giữ thông tin giới thiệu trong một cookie trong trình duyệt của bạn trong 60 ngày, để người đã gửi liên kết nhận được ghi nhận nếu bạn đăng ký. Tại Khu vực Kinh tế Châu Âu, Vương quốc Anh và Thụy Sĩ, chúng tôi chỉ đặt cookie này sau khi bạn đồng ý trên agentes.chat. Để quên thông tin giới thiệu trên thiết bị này, hãy mở https://agentes.chat/vi/privacy?forget-referral#cookies.",
        ],
      },
      {
        id: "children",
        heading: "15. Trẻ em",
        blocks: [
          "Dịch vụ là một công cụ làm việc cho người lớn. Dịch vụ không hướng tới bất kỳ ai dưới 18 tuổi, và chúng tôi không cố ý thu thập dữ liệu cá nhân của họ. Nếu bạn cho rằng một trẻ vị thành niên đã cung cấp dữ liệu cá nhân cho chúng tôi, hãy viết tới privacy@agentes.chat và chúng tôi sẽ xóa dữ liệu đó.",
        ],
      },
      {
        id: "changes",
        heading: "16. Thay đổi đối với chính sách này",
        blocks: [
          "Chúng tôi có thể cập nhật chính sách này. Các thay đổi quan trọng sẽ được thông báo qua email hoặc trong ứng dụng trước khi chúng có hiệu lực. Phiên bản hiện tại luôn nằm tại trang này. Nếu một bản dịch và bản tiếng Anh khác nhau, bản tiếng Anh được ưu tiên áp dụng, trừ khi pháp luật yêu cầu khác.",
        ],
      },
      {
        id: "contact",
        heading: "17. Liên hệ",
        blocks: [
          "AGENTESCHAT, LLC, hoạt động kinh doanh dưới tên agentes.chat. Thông báo: 2810 North Church Street, Ste 91038, Wilmington, DE 19802, USA · privacy@agentes.chat. Các câu hỏi về bảo vệ dữ liệu từ EU, Vương quốc Anh và Brazil đến nhóm bảo mật của chúng tôi tại cùng địa chỉ. Để được trợ giúp về Dịch vụ, hãy viết tới support@agentes.chat. Đối với mọi vấn đề khác, hãy viết tới hello@agentes.chat.",
        ],
      },
    ],
  },
};
