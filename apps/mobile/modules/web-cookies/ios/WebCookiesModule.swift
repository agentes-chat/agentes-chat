import ExpoModulesCore
import WebKit

/// The cookies the app's web views hold for a server (ADR 0195 §10): a gate's sign-in (Cloudflare Access) happens in
/// a web view, and its session is a cookie Access sets there, HttpOnly, out of the page's reach. The web views share
/// the default WebKit store (react-native-webview's default).
public class WebCookiesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WebCookies")

    // The cookies a request to `url` would carry, by name.
    AsyncFunction("get") { (url: URL, promise: Promise) in
      WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
        var found: [String: String] = [:]
        for cookie in cookies where Self.sent(cookie, to: url) {
          found[cookie.name] = cookie.value
        }
        promise.resolve(found)
      }
    }.runOnQueue(.main)

    // Deletes the cookie `name` a request to `url` would carry.
    AsyncFunction("remove") { (url: URL, name: String, promise: Promise) in
      let store = WKWebsiteDataStore.default().httpCookieStore
      store.getAllCookies { cookies in
        let gone = cookies.filter { $0.name == name && Self.sent($0, to: url) }
        let group = DispatchGroup()
        for cookie in gone {
          group.enter()
          store.delete(cookie) { group.leave() }
        }
        group.notify(queue: .main) { promise.resolve(nil) }
      }
    }.runOnQueue(.main)
  }

  /// Whether a request to `url` carries `cookie`: its domain (the host itself, or one it covers), path and `Secure`.
  private static func sent(_ cookie: HTTPCookie, to url: URL) -> Bool {
    guard let host = url.host?.lowercased() else { return false }
    let domain = cookie.domain.lowercased()
    let covers = domain.hasPrefix(".")
      ? host == String(domain.dropFirst()) || host.hasSuffix(domain)
      : host == domain
    let path = url.path.isEmpty ? "/" : url.path
    return covers && path.hasPrefix(cookie.path) && (!cookie.isSecure || url.scheme == "https")
  }
}
