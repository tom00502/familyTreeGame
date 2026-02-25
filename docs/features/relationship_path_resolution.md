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
    ↓
虛擬節點重複檢查 (父母節點收斂)
    ↓
最終骨架族譜
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

### 步驟四：虛擬節點重複檢查 (Parent Node Deduplication)

**目標**：將多條路徑產生的同一現實人物之重複虛擬節點合併，確保族譜結構不出現同一人的分身

#### 問題場景

由於每條關係路徑獨立產生虛擬節點，不同路徑可能對同一個現實人物建出多個不同 ID 的虛擬節點：

```
玩家 A 宣告「B 是我兄弟」→ 產生 virt_A_P_f（A 的父親虛擬節點）
玩家 B 宣告「A 是我兄弟」→ 產生 virt_B_P_f（B 的父親虛擬節點）

若 A、B 是兄弟，兩者的「父親」應為同一人，但系統產生了兩個節點
```

#### 收斂規則

針對每個節點 B（玩家節點或虛擬節點），執行以下檢查：

| 條件                                         | 動作                           |
| -------------------------------------------- | ------------------------------ |
| B 有多個**男性虛擬節點**以 `parent` 邊指向 B | 保留其中一個，其餘合併入該節點 |
| B 有多個**女性虛擬節點**以 `parent` 邊指向 B | 保留其中一個，其餘合併入該節點 |

**合併操作定義**：

1. 選定一個候選節點作為**留存節點**（保留最早產生者）
2. 將所有指向「待刪節點」的邊，重新導向至留存節點（`from`、`to` 全部替換）
3. 將所有從「待刪節點」出發的邊，改為從留存節點出發
4. 刪除待刪節點，並移除合併後產生的重複邊

#### 演算法虛擬碼

```
repeat until no merge occurred in this pass:   ← 迭代收斂，直到不動點
  changed = false

  for 每個節點 B in 族譜:
    fatherCandidates = 所有滿足條件的節點：
      - 是虛擬節點（isVirtual = true）
      - gender = male
      - 存在邊 candidate → B（type = parent）

    if fatherCandidates.length >= 2:
      keepNode = fatherCandidates[0]
      for mergeNode in fatherCandidates[1..]:
        所有邊中 from/to = mergeNode → 替換為 keepNode
        刪除 mergeNode
      移除重複邊
      changed = true

    # 女性（母親）重複同理
    motherCandidates = 所有滿足條件的節點：
      - 是虛擬節點（isVirtual = true）
      - gender = female
      - 存在邊 candidate → B（type = parent）

    if motherCandidates.length >= 2:
      keepNode = motherCandidates[0]
      ... (同上)
      changed = true
```

> **為何需要迭代**：單次合併後，留存節點（keepId）會繼承被合併節點的所有子節點邊，
> 導致留存節點的父母層可能再次出現重複。例如：V1 與 V2 合併後，V1 從 V2 繼承了新的父親虛擬節點，
> 而 V1 自身也有一個父親虛擬節點，造成 V1 現在有兩個父親。
> 因此必須持續迭代直到一個 pass 中沒有發生任何合併（不動點）。

#### 注意事項

- **性別未知節點（`gender = unknown`）不參與此收斂**，因無法確認為父或母，留待第二階段填充
- **玩家節點不作為合併目標**，只有虛擬節點會被合併，若有兩條路徑讓同一玩家同時出現在 B 的父親與母親位置，屬於衝突記錄，進入路徑衝突流程（見規則 2）
- **合併後需重新去重邊**，因合併可能讓兩條原本指向不同節點的邊變成重複邊（相同 from、to、type）
- **必須重複執行直到不動點**，合併本身可能引發新的重複：留存節點繼承被合併節點的父母邊後，可能導致自身擁有多個同性別父母節點，需在下一 pass 再次收斂

#### 收斂範例

```
收斂前：
  nodes: [A(玩家), B(玩家), V1(男性虛擬, label=父親), V2(男性虛擬, label=父親)]
  edges: [V1→A (parent), V1→B (parent), V2→A (parent)]
                                               ↑
                               V1 與 V2 都是 A 的虛擬父親

Pass 1 收斂（A 的父親 V1+V2 → 保留 V1）：
  nodes: [A(玩家), B(玩家), V1(男性虛擬, label=父親)]
  edges: [V1→A (parent), V1→B (parent)]
         ↑ V2→A 被替換為 V1→A，但 V1→A 已存在，重複邊移除

→ 此 pass 無新合併，收斂完成
```

**級聯合併範例（需多 pass）**：

```
收斂前：
  nodes: [A(玩家), B(玩家), C(玩家),
          V1(男虛擬,父), V2(男虛擬,父), V3(男虛擬,祖父), V4(男虛擬,祖父)]
  edges:
    V1→A (parent), V2→B (parent),
    V3→V1 (parent), V4→V2 (parent)   ← V1、V2 各自有不同的虛擬祖父
  ＋ V1→C (parent), V2→C (parent)    ← 透過 C 發現 V1、V2 應為同一人

Pass 1：C 有兩個男性虛擬父親 V1、V2 → 合併，保留 V1，刪除 V2
  邊中 V2 全換為 V1：
    V1→A, V1→B, V1→C (parent)
    V3→V1, V4→V1 (parent)
  去重後：edges = [V1→A, V1→B, V1→C, V3→V1, V4→V1]

Pass 2：V1 現在有兩個男性虛擬父親 V3、V4 → 合併，保留 V3，刪除 V4
  edges = [V1→A, V1→B, V1→C, V3→V1]

Pass 3：掃描所有節點，無任何合併 → 收斂完成
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
- [x] **虛擬節點重複檢查**：同一節點有多個男性虛擬父節點 → 合併；女性同理
- [x] **合併後去重邊**：確保合併不產生 from/to/type 完全相同的重複邊
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
