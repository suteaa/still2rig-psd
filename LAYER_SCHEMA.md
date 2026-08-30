# Still2Rig VTuber Edition — LAYER_SCHEMA

## 1. Purpose

本ファイルはStill2Rig VTuber Editionが生成する、

* PSD Layer
* Folder Hierarchy
* Canonical ID
* Left / Right
* Parent
* Metadata

の規格を定義する。

この規格は将来の `AutoRig for Cubism` とのAPI Contractとして扱う。

安易に変更しないこと。

変更する場合はSchema Versionを更新する。

---

# 2. Left / Right Convention

L/Rは必ず、

**キャラクター本人から見たLeft / Right**

とする。

画面基準ではない。

正面キャラクターの場合：

```text
Viewer Left  = Character Right
Viewer Right = Character Left
```

この定義をすべての部位で統一する。

---

# 3. Canonical ID Rule

Canonical ID：

```text
lowercase
dot separated
semantic
stable
machine readable
```

例：

```text
hair.front.left
eye.left.iris
arm.right.forearm
```

PSD Layer Name：

```text
FrontHair_L
Iris_L
Forearm_R
```

Canonical IDとPSD表示名を分離する。

---

# 4. Root Hierarchy

推奨PSD構造：

```text
ROOT
├─ Hair
├─ Face
├─ Mouth
└─ Body
```

PSD階層は人間向け。

AutoRigはCanonical IDを優先する。

---

# 5. Hair

```text
Hair
├─ Back
│  ├─ BackHair_L_01
│  ├─ BackHair_L_02
│  ├─ BackHair_L_03
│  ├─ BackHair_R_01
│  ├─ BackHair_R_02
│  └─ BackHair_R_03
│
├─ Side
│  ├─ SideHair_L
│  └─ SideHair_R
│
├─ Front
│  ├─ FrontHair_L
│  ├─ FrontHair_C
│  └─ FrontHair_R
│
├─ Sideburn
│  ├─ Sideburn_L
│  └─ Sideburn_R
│
└─ Ahoge
```

Canonical IDs：

```text
hair.front.left
hair.front.center
hair.front.right

hair.side.left
hair.side.right

hair.back.left.01
hair.back.left.02
hair.back.left.03

hair.back.right.01
hair.back.right.02
hair.back.right.03

hair.sideburn.left
hair.sideburn.right

hair.ahoge
```

BackHair strand indexは2桁ゼロ埋め。

```text
01
02
03
```

---

# 6. Face

```text
Face
├─ FaceBase
├─ Ear_L
├─ Ear_R
├─ Eye_L
│  ├─ EyeWhite_L
│  ├─ Iris_L
│  └─ Eyelash_L
├─ Eye_R
│  ├─ EyeWhite_R
│  ├─ Iris_R
│  └─ Eyelash_R
├─ Eyebrow_L
├─ Eyebrow_R
└─ Nose
```

Canonical IDs：

```text
face.base

ear.left
ear.right

eye.left.white
eye.left.iris
eye.left.lash

eye.right.white
eye.right.iris
eye.right.lash

brow.left
brow.right

nose
```

存在しない部位は作らない。

---

# 7. Mouth

最低構成：

```text
Mouth
└─ MouthBase
```

Canonical：

```text
mouth.base
```

拡張構成：

```text
Mouth
├─ UpperLip
├─ LowerLip
├─ MouthInside
├─ Teeth
└─ Tongue
```

Canonical：

```text
mouth.upper_lip
mouth.lower_lip
mouth.inside
mouth.teeth
mouth.tongue
```

生成補完した歯・舌などは必ずGeneratedとして記録する。

---

# 8. Body

```text
Body
├─ Neck
├─ Torso
├─ Arm_L
│  ├─ UpperArm_L
│  ├─ Forearm_L
│  └─ Hand_L
└─ Arm_R
   ├─ UpperArm_R
   ├─ Forearm_R
   └─ Hand_R
```

Canonical：

```text
body.neck
body.torso

arm.left.upper
arm.left.forearm
arm.left.hand

arm.right.upper
arm.right.forearm
arm.right.hand
```

---

# 9. Optional Depth Variants

同一Partが前後に分かれる必要がある場合、

```text
UpperArm_L_Back
UpperArm_L_Front
```

を許可する。

Canonical例：

```text
arm.left.upper.back
arm.left.upper.front
```

ただし乱用しない。

---

# 10. Optional Part Policy

以下はOptional：

```text
Ear
Nose
Sideburn
Ahoge
Mouth subparts
Hair multiple strands
Arm subdivisions
```

存在しない部位の空レイヤーは禁止。

---

# 11. Parent Contract

ManifestではPart Parentを定義する。

例：

```json
{
  "id": "eye.left.iris",
  "parent": "eye.left"
}
```

Virtual Parentを許可する。

例：

```text
eye.left
```

自体がPSD raster layerでなくてもよい。

---

# 12. Side Field

値：

```text
left
right
center
none
```

例：

```json
{
  "id": "hair.front.center",
  "side": "center"
}
```

---

# 13. Source Type

値：

```text
observed
generated
mixed
```

意味：

```text
observed
元画像由来のみ

generated
生成補完のみ

mixed
元画像＋生成補完
```

---

# 14. Confidence

0.0〜1.0。

```json
{
  "confidence": 0.93
}
```

UI分類：

```text
HIGH   >= 0.85
MEDIUM >= 0.60
LOW    < 0.60
```

---

# 15. Geometry

各Part：

```json
{
  "bbox": [x1, y1, x2, y2],
  "centroid": [0.44, 0.27]
}
```

bbox：

```text
pixel coordinates
```

centroid：

```text
normalized coordinates
0.0–1.0
```

---

# 16. Rig Hints

可能な場合：

```json
{
  "pivot_hint": [0.42, 0.58],
  "anchor_hint": [0.43, 0.51],
  "rotation_axis_hint": 1.57
}
```

すべて正規化座標を推奨。

Angleはradianまたはdegreeのどちらかに統一し、Manifest schemaで明記する。

推奨：

```text
radian
```

---

# 17. Joint Hints

腕：

```json
{
  "joint_hints": {
    "shoulder": [0.31, 0.42],
    "elbow": [0.27, 0.60],
    "wrist": [0.24, 0.75]
  }
}
```

推定できない値はnull。

捏造しない。

---

# 18. Hair Root Hint

Hair Strandには可能なら：

```json
{
  "root_hint": [0.51, 0.18],
  "tip_hint": [0.43, 0.54]
}
```

を保存する。

将来のHair Physics生成に利用する。

---

# 19. Z Index

各Part：

```json
{
  "z_index": 42
}
```

数値が大きいほど手前、または逆といった規則をSchemaで固定する。

推奨：

```text
larger = front
```

---

# 20. Generated Area

```json
{
  "generated_area_ratio": 0.18
}
```

値：

```text
0.0–1.0
```

0：

```text
完全Observed
```

1：

```text
完全Generated
```

---

# 21. Source Mapping

元Semantic Layerとの対応を保存する。

```json
{
  "source_tag": "irides"
}
```

複数の場合：

```json
{
  "source_tags": [
    "front hair",
    "back hair"
  ]
}
```

---

# 22. Recommended Manifest Structure

```json
{
  "schema": "still2rig-vtuber",
  "schema_version": 1,

  "canvas": {
    "width": 2048,
    "height": 2048
  },

  "character": {
    "face_center": [0.51, 0.27],
    "body_center": [0.50, 0.55],
    "axis_confidence": 0.94
  },

  "parts": [
    {
      "id": "eye.left.iris",
      "psd_layer": "Iris_L",
      "parent": "eye.left",
      "side": "left",
      "source_tag": "irides",
      "bbox": [850, 510, 970, 620],
      "centroid": [0.444, 0.276],
      "confidence": 0.98,
      "source_type": "observed",
      "generated_area_ratio": 0.0,
      "z_index": 42,
      "pivot_hint": [0.444, 0.276]
    }
  ]
}
```

---

# 23. Required V1 IDs

可能な限り以下を生成する。

必須コア：

```text
face.base
body.neck
body.torso
```

Eyes：

```text
eye.left.white
eye.right.white

eye.left.iris
eye.right.iris

eye.left.lash
eye.right.lash

brow.left
brow.right
```

Hair：

```text
hair.front.left
hair.front.center
hair.front.right

hair.side.left
hair.side.right
```

Back Hair最低：

```text
hair.back.left
hair.back.right
```

または：

```text
hair.back.left.01
hair.back.right.01
```

Body：

```text
arm.left.upper
arm.left.forearm
arm.left.hand

arm.right.upper
arm.right.forearm
arm.right.hand
```

ただし検出不能なOptional Partは未生成を許可する。

---

# 24. Validation Rules

禁止：

```text
同一Canonical IDが2つ存在
LとRが逆
存在しない部位の空Layer
Canonical IDなしLayer
NaN geometry
範囲外normalized coordinate
generated_area_ratio > 1
confidence > 1
```

---

# 25. Schema Versioning

Manifestには必ず：

```json
{
  "schema_version": 1
}
```

を含める。

破壊的変更：

```text
Major version increment
```

後方互換追加：

```text
Minor versionまたはoptional field追加
```

AutoRigはSchema Versionを確認してから処理する。

---

# 26. Rule of Truth

最優先情報：

```text
Canonical ID
```

次：

```text
Manifest Metadata
```

次：

```text
PSD Hierarchy / Layer Name
```

つまりAutoRigは、

**PSDのレイヤー名を文字列推測して部位判定しない。**

Manifestを正式なMachine Contractとして扱う。
