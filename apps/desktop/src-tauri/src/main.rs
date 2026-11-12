// No console window on Windows release builds (later); macOS ignores it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Linux: whether WebKitGTK draws with the GPU (webkit_gpu.rs). Settled before any thread starts; the person's
    // own WEBKIT_DISABLE_DMABUF_RENDERER wins.
    #[cfg(target_os = "linux")]
    if let agentes_desktop_lib::webkit_gpu::Drawing::Cpu(why) = agentes_desktop_lib::webkit_gpu::settle() {
        eprintln!("agentes.chat: drawing on the CPU ({why}); WEBKIT_DISABLE_DMABUF_RENDERER=0 asks for the GPU");
    }
    agentes_desktop_lib::run();
}
