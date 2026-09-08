// Build an instrumented copy; the shipping application has no test commands.
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Database } from "bun:sqlite";

const root = resolve(import.meta.dir, "..");
const directory = mkdtempSync(join(tmpdir(), "qmem-native-"));
cpSync(join(root, "src-tauri"), directory, {
  recursive: true,
  filter: (path) => !path.startsWith(join(root, "src-tauri/target")) && !path.startsWith(join(root, "src-tauri/gen")),
});
const configPath = join(directory, "tauri.conf.json");
const config = JSON.parse(readFileSync(configPath, "utf8"));
config.build.frontendDist = join(root, "dist");
writeFileSync(configPath, JSON.stringify(config));
const sourcePath = join(directory, "src/main.rs");
let source = readFileSync(sourcePath, "utf8");
source = source.replace("let directory = app.path().app_data_dir()?;", 'let directory = std::path::PathBuf::from(std::env::var("QMEM_TEST_DIR")?);');
source = source.replace("window.set_focus().map_err(|e| e.to_string())", `window.set_focus().map_err(|e| e.to_string())?;
    window.eval(include_str!("native-smoke.js")).map_err(|e| e.to_string())`);
source = source.replace("            save_note,", "            smoke_done,\n            save_note,");
source += `
#[tauri::command]
fn smoke_done(app: tauri::AppHandle, window: tauri::WebviewWindow, result: String) -> String {
    if result != "ok" && result != "reopened" { eprintln!("NATIVE FAIL: {}", result); std::process::exit(1); }
    println!("NATIVE UI PASS");
    if result == "ok" && std::env::var("QMEM_TEST_CLOSE").unwrap() == "window" {
        window.close().unwrap();
        std::thread::spawn(move || {
            for _ in 0..100 {
                if !window.is_visible().unwrap() {
                    let db = app.state::<Database>();
                    let db = db.0.lock().unwrap();
                    assert_eq!(storage::search(&db, "").unwrap()[0].body, "終了直前の本文");
                    drop(db);
                    reopen(&app);
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            eprintln!("NATIVE FAIL: window did not hide");
            std::process::exit(1);
        });
        "window".into()
    } else { app.exit(0); "quit".into() }
}
`;
writeFileSync(sourcePath, source);
writeFileSync(join(directory, "src/native-smoke.js"), readFileSync(join(import.meta.dir, "native-smoke-page.js")));

function run(command, env = {}) {
  const result = Bun.spawnSync(command, { cwd: root, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit", timeout: 120_000 });
  if (result.exitCode !== 0) throw Error(`${command[0]} failed: ${result.exitCode}`);
}
const target = join(root, "src-tauri/target");
run(["cargo", "build", "--manifest-path", join(directory, "Cargo.toml"), "--target-dir", target, "--features", "tauri/custom-protocol"]);
for (const mode of ["window", "quit"]) {
  run([join(target, "debug/qmem")], { QMEM_TEST_DIR: directory, QMEM_TEST_CLOSE: mode });
  const db = new Database(join(directory, "notes.sqlite3"), { readonly: true });
  const notes = db.query("SELECT body FROM notes ORDER BY id").all();
  db.close();
  if (notes.length !== 1 || notes[0].body !== "終了直前の本文") throw Error(`Persistence failed: ${JSON.stringify(notes)}`);
  console.log(`PASS: ${mode}, persisted final input; database: ${directory}/notes.sqlite3`);
}
