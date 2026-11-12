// No console window on Windows release builds (later); macOS ignores it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Linux: how WebKitGTK draws (linux_webkit.rs). Settled before any thread starts; the person's own
    // WEBKIT_DISABLE_DMABUF_RENDERER wins.
    #[cfg(target_os = "linux")]
    {
        use agentes_desktop_lib::linux_webkit::{settle, Drawing};
        if settle() == Drawing::GpuWithoutExplicitSync {
            eprintln!("agentes.chat: NVIDIA on Wayland, drawing on the GPU with __NV_DISABLE_EXPLICIT_SYNC=1");
        }
    }
    agentes_desktop_lib::run();
}
