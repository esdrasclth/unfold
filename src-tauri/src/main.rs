// En release no queremos que Windows abra tambien una consola detras.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    unfold_lib::run()
}
