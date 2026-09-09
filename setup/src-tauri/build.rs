fn main() {
    // El instalador NSIS se empotra en el binario, y ese artefacto sólo existe
    // tras compilar la aplicación entera en modo release. Por eso esta caja no
    // pasaba por CI: allí no hay artefacto y no compilaba.
    //
    // Con `UNFOLD_SIN_INSTALADOR` se compila con un hueco vacío, que basta para
    // clippy y para las pruebas. Es un interruptor explícito y no una vuelta
    // automática al hueco: un instalador que no instala nada tiene que ser algo
    // que alguien pida a propósito, nunca lo que salga de un artefacto perdido.
    println!("cargo::rustc-check-cfg=cfg(sin_instalador)");
    println!("cargo::rerun-if-env-changed=UNFOLD_SIN_INSTALADOR");
    if std::env::var_os("UNFOLD_SIN_INSTALADOR").is_some() {
        println!("cargo::rustc-cfg=sin_instalador");
    }
    tauri_build::build()
}
