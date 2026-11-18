package chat.agentes.webcookies

import android.webkit.CookieManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The cookies the app's web views hold for a server (ADR 0195 §10): a gate's sign-in (Cloudflare Access) happens in a
 * web view, and its session is a cookie Access sets there, HttpOnly, out of the page's reach. Android's web views share
 * one `CookieManager`, which reads HttpOnly cookies too.
 */
class WebCookiesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WebCookies")

    // The cookies a request to `url` would carry, by name.
    AsyncFunction("get") { url: String ->
      val header = CookieManager.getInstance().getCookie(url) ?: ""
      header.split(";").mapNotNull { pair ->
        val at = pair.indexOf('=')
        if (at <= 0) null else pair.substring(0, at).trim() to pair.substring(at + 1).trim()
      }.toMap()
    }

    // Deletes the cookie `name` a request to `url` would carry: set again, already expired, as it was set (host-only,
    // on `/`, Secure on https).
    AsyncFunction("remove") { url: String, name: String ->
      val manager = CookieManager.getInstance()
      val secure = if (url.startsWith("https://")) "; Secure" else ""
      manager.setCookie(url, "$name=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/$secure")
      manager.flush()
    }
  }
}
