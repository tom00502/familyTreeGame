# 關係路徑解析規格書 (Relationship Path Resolution Spec)

## 📖 簡介

本規格書定義如何將玩家提交的「親屬關係宣告」轉化為**邏輯序列**，作為生成骨架族譜 (Skeleton MVFT) 的第一步。

**流程總覽**：

```
關係紀錄（玩家輸入）
    ↓
稱謂映射 (標準化)
    ↓
BFS 圖形遍歷 (尋找最短路徑)
    ↓
邏輯序列 (如 ["P_m", "P_any", "C_any", "C_f"])
    ↓
骨架族譜生成器 (實體化虛擬節點)
```

---

## 1️⃣ 名詞定義

| 術語                                | 定義                           | 說明                                    |
| ----------------------------------- | ------------------------------ | --------------------------------------- |
| **關係紀錄 (Relationship Record)**  | 玩家提交的原始輸入數據         | 包含發起者、目標對象與稱謂標籤          |
| **稱謂地圖 (Kinship Map)**          | 靜態的邏輯導航底圖             | 預先定義所有親屬位置及其 P, C, S 連線   |
| **關鍵路徑 (Key Path)**             | 連結兩位玩家間的邏輯血緣路徑   | 確保兩點在圖論結構上達到最短連接        |
| **邏輯序列 (Logical Sequence)**     | 路徑解析後的代碼產出           | 如 `["P", "P", "C", "C"]`，代表導航步驟 |
| **歧義解析 (Ambiguity Resolution)** | 處理同名稱謂對應多條路徑的程序 | 例如區分「父系表姊」與「母系表姊」      |

---

## 2️⃣ 輸入資料結構

當玩家 A 指向玩家 B 並宣稱其關係時，系統接收以下格式之數據：

```json
{
  "subject": "Player_A_ID", // 宣告者 (原點)
  "object": "Player_B_ID", // 被宣告者 (目標點)
  "title": "表姐", // 稱謂字串
  "context": "maternal" // 歧義過濾參數 (由 UI 選單提供)
}
```

### 數據欄位說明

- **subject** (必填)：發起宣告的玩家 ID
- **object** (必填)：被宣告的目標玩家 ID
- **title** (必填)：描述兩人關係的稱謂（如「叔叔」「表妹」「伯父」）
- **context** (可選)：消除稱謂歧義的上下文標籤
  - `"paternal"` / `"maternal"`：區分父系與母系
  - `"sibling"` / `"elder"` / `"younger"`：區分兄弟姊妹的年序
  - 若不提供，系統應列舉所有可能的路徑供確認

---

## 3️⃣ 解析演算法流程

系統透過以下四個步驟，將上述輸入轉化為骨架族譜所需的指令：

### 步驟一：稱謂映射 (Title Mapping)

**目標**：將自然語言稱謂標準化為 KinshipMap 中的節點 ID

**邏輯**：

1. 在 KinshipMap 中檢索該稱謂
2. 若稱謂具有多個解釋（歧義），根據 `context` 鎖定唯一目標
3. 輸出標準化的節點 ID

**範例**：

```
輸入：
  title: "表姐"
  context: "maternal"

KinshipMap 查詢結果：
  - 若無 context：[paternal_cousin (女), maternal_cousin (女)] 都符合
  - 有 context="maternal"：唯一目標 → maternal_cousin_node

輸出：maternal_cousin
```

---

### 步驟二：圖形遍歷 (BFS Navigation)

**目標**：尋找從發起者到目標的最短血緣路徑

**邏輯**：

1. 以 `self`（發起玩家 A）為起點
2. 利用**廣度優先搜尋 (BFS)** 在 KinshipMap 的邊圖中導航
3. 優先找到邊數最少（親等最近）的連線組合
4. 若在 5 步（五等親）內找不到路徑，回傳 `PathNotFound`

**搜尋規則**：

- 尊重 KinshipMap 中的邊定義（edges）
- 優先選擇最短路徑（避免迂迴繞路）
- 遵守性別限制（如父親只能是男性，母親只能是女性）

**範例**：

```
起點：Player A (self)
目標：maternal_cousin
KinshipMap 邊定義：
  self → P_m → mother
  mother → P_m → maternal_grandmother
  maternal_grandmother → C_any → maternal_uncle_aunt
  maternal_uncle_aunt → C_any → maternal_cousin

BFS 結果：
  self → [P_m] → mother → [P_m] → maternal_grandmother
       → [C_any] → maternal_uncle_aunt → [C_any] → maternal_cousin

路徑邊序列：[P_m, P_m, C_any, C_any]
```

---

### 步驟三：標籤注入 (Tag Injection)

**目標**：為路徑中的每條邊標記方向與性別屬性，確保後續虛擬節點具備正確的性別

**邊類型定義**：

| 邊類型  | 方向   | 含義                 |
| ------- | ------ | -------------------- |
| `P_f`   | ↑ 向上 | 連向父親             |
| `P_m`   | ↑ 向上 | 連向母親             |
| `C_m`   | ↓ 向下 | 連向兒子             |
| `C_f`   | ↓ 向下 | 連向女兒             |
| `C_any` | ↓ 向下 | 連向子女（任意性別） |
| `S`     | → 水平 | 連向配偶             |
| `P_any` | ↑ 向上 | 連向父母（任意）     |

**標籤注入邏輯**：

遍歷 BFS 結果中的每條邊，保留或轉換其性別標記：

```
若邊為 [P_m, P_m, C_any, C_any]
轉換後（若需要指定性別）：
  - P_m：母親，性別已確定 (F)
  - P_m：祖母，性別已確定 (F)
  - C_any：舅舅/阿姨（子女），性別待定
  - C_any：表兄妹（孫代），性別待定

輸出邏輯序列：["P_m", "P_m", "C_any", "C_any"]
```

---

## 4️⃣ 實例運算展示

### 場景

玩家 A 宣告玩家 B 是他的「表姐（母系）」

### 執行步驟

**步驟一：稱謝映射**

```
輸入：title="表姐", context="maternal"
KinshipMap 查詢：表姐 + maternal → maternal_cousin (且性別為女)
輸出目標節點：maternal_cousin (Female)
```

**步驟二：BFS 導航**

```
起點：self (Player A)
目標：maternal_cousin

遍歷路徑：
  self --[P_m]--> mother
       --[P_m]--> maternal_grandmother
       --[C_any]--> maternal_uncle_aunt (或 maternal_aunt)
       --[C_f]--> maternal_cousin_female (Player B)

路徑長度：4 步 (四等親)
```

**步驟三：標籤注入**

```
邊序列：[P_m, P_m, C_any, C_f]
性別標記：
  - P_m：母親 (F)
  - P_m：祖母 (F)
  - C_any：舅舅/阿姨 (M/F)
  - C_f：女性表親 (F)
```

**最終輸出邏輯序列**：

```
["P_m", "P_m", "C_any", "C_f"]
```

此序列將交給**骨架族譜生成器**，檢查路徑中缺失的虛擬節點並實例化。

---

## 5️⃣ 異常處理與邊界規則

### 規則 1：路徑不存在

**觸發條件**：BFS 無法在 5 步（五等親）內找到目標

**處理方式**：

```
系統回傳：PathNotFound
錯誤訊息：「關係過於疏遠，無法建立關鍵路徑」
UI 反饋：禁用此關係的提交，提示玩家選擇更近的親屬關係
```

### 規則 2：路徑衝突

**觸發條件**：A 與 B 之間已存在一條關鍵路徑，新路徑與舊路徑產生邏輯矛盾

**範例**：

```
已錄入：A 是 B 的爸爸
新輸入：A 是 B 的表哥

邏輯檢查：
  - 路徑 1（爸爸）：A → B（直系，1 步）
  - 路徑 2（表哥）：A → ... → B（旁系，4+ 步）

判定：衝突！同一對象不能同時出現在兩個互斥的路徑上
```

**處理方式**：

```
系統攔截此輸入
進入「階段三：衝突校對」處理
標記為待人工確認的衝突記錄
```

### 規則 3：歧義路徑

**觸發條件**：同一稱謝對應多條等長路徑（如「表兄」可能來自父系或母系）

**處理方式**：

```
若 context 未提供：
  1. 列舉所有可能的路徑
  2. 詢問玩家選擇（如「父系表兄」或「母系表兄」）
  3. 根據選擇確定唯一路徑

若 context 已提供：
  使用 context 篩選，輸出唯一路徑
```

---

## 📝 實作檢查清單

- [ ] KinshipMap 已完整定義所有親屬稱謝及其邊關係
- [ ] 稱謝映射函式能正確處理歧義 (歧義列表與 context 過濾)
- [ ] BFS 演算法在 KinshipMap 上運作正確（測試案例：直系、旁系、配偶等）
- [ ] 邊類型標籤 (P_f, P_m, C_m, C_f 等) 被正確注入
- [ ] 路徑長度限制為 5 步（五等親）
- [ ] 路徑衝突檢測機制已實作
- [ ] 歧義處理流程已整合至 UI 選單邏輯

---

## 相關文件

- [concepts/mvft.md](../concepts/mvft.md) - MVFT 核心概念
- [features/qa_phase2_data_filling.md](./qa_phase2_data_filling.md) - 資料填充策略
- [public/kinshipMap.json](/public/kinshipMap.json) - 稱謝地圖定義（參考實作）

---

**文件版本**：1.0  
**最後更新**：2026-02-24  
**維護者**：Family Tree Game Project
