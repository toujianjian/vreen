# VREEN — Multi-language Package Format & Tools

VREEN 是一个跨引擎、跨语言的 3D 项目包格式。`.vreen` 文件 = **ZIP** 容器,
包含 manifest + scene + 资产 + 可选嵌入 ECS world。配套工具支持验证、增量更新、跨语言 SDK。

## 结构总览

```
.
├── docs/
│   └── format/
│       └── vreen-format-spec.md      权威规范 (语言中立)
├── packages/
│   ├── vreen-core/                   JVM/Kotlin 库 (Maven, 公开)
│   ├── unity-package/                Unity UPM 包 (C#, Runtime + Editor)
│   ├── unreal-plugin/                Unreal 插件 (C++17, Runtime module)
│   └── registry/                     包仓库索引 + JSON schema + 示例
├── scripts/
│   └── vreen-cli.mjs                 跨平台 CLI (Node ≥16)
├── src/
│   └── lib/
│       ├── vreenPack.ts              TypeScript 打包/解包
│       ├── vreenValidate.ts          完整性 + schema 验证
│       ├── vreenDiff.ts              增量包 (diff/apply)
│       └── vreenRegistry.ts          仓库客户端解析
└── package.json                      "vreen" script → CLI
```

## 5 分钟上手 (TypeScript / Web)

```bash
npm install
npm run vreen -- validate ./demo.vreen
npm run vreen -- diff base.vreen head.vreen
npm run vreen -- delta base.vreen head.vreen head.vreen-delta
npm run vreen -- apply base.vreen head.vreen-delta head.vreen
npm run vreen -- registry list https://registry.vreen.dev/index.json
```

## 5 分钟上手 (Kotlin / Java)

```xml
<dependency>
    <groupId>io.vreen</groupId>
    <artifactId>vreen-core</artifactId>
    <version>0.2.1</version>
</dependency>
```

```kotlin
import io.vreen.core.Vreen
import io.vreen.core.model.AssetKind

val packed = Vreen.pack(Vreen.PackInput(
    name = "demo",
    assetName = "robot.glb",
    assets = listOf(Vreen.AssetInput(
        kind = AssetKind.MODEL,
        data = glbBytes,
        originalName = "robot.glb"
    ))
))
java.io.File("demo.vreen").writeBytes(packed.bytes)
```

## 5 分钟上手 (Unity)

1. `Packages/manifest.json`:
   ```json
   { "dependencies": { "io.vreen.unity": "file:../vreen/packages/unity-package" } }
   ```
2. **VREEN → Open Package…** 打开 .vreen 文件。
3. 运行时: `VreenLoader.Unpack(bytes)`, `VreenLoader.Validate(pkg)`.

## 5 分钟上手 (Unreal)

1. 把 `packages/unreal-plugin/` 复制到 `Plugins/VreenRuntime/`。
2. `.uproject` 启用 `VreenRuntime`。
3. 重新生成项目文件 + 编译。
4. C++: `FVreenLoader::Pack(input)`, `FVreenLoader::Unpack(bytes)`, `FVreenLoader::Validate(pkg)`.

## 规范

完整规范见 [docs/format/vreen-format-spec.md](./docs/format/vreen-format-spec.md) — 所有 SDK 的真值源。

## 各模块状态

| 模块 | 状态 | 备注 |
|---|---|---|
| 规范文档 | ✅ 0.2.1 | docs/format/vreen-format-spec.md |
| TypeScript 核心 | ✅ 0.2.1 | src/lib/vreen{Pack,Validate,Diff,Registry}.ts |
| CLI (Node) | ✅ | scripts/vreen-cli.mjs |
| Kotlin/Java vreen-core | ✅ 0.2.1 | packages/vreen-core |
| Unity UPM | ✅ 0.2.1 | packages/unity-package |
| Unreal Plugin | ✅ 0.2.1 | packages/unreal-plugin |
| Registry schema | ✅ 1.0.0 | packages/registry/schema.json |
| Registry example | ✅ | packages/registry/example-index.json |

## 设计原则

1. **语言中立** — 所有 SDK 遵循同一份规范,JSON 字段稳定。
2. **零依赖** — 核心包不引入 fflate/zlib 之外的任何东西。
3. **前向兼容** — 读 0.1.x 容器,自动迁移到 0.2.x。
4. **可增量** — `.vreen-delta` 只发 diff,带宽最优。
5. **可校验** — sha256 + size + schema,所有错误都有 code 便于 UI 提示。

## 下一步

- [ ] Java 包发到 Maven Central
- [ ] Unity 包发到 OpenUPM
- [ ] Unreal 插件发到 FAB Marketplace
- [ ] 注册中心 host: registry.vreen.dev
- [ ] v0.3.0 加密 (AES-GCM) + 签名 (Ed25519)
- [ ] v0.4.0 流式大场景

## License

MIT
