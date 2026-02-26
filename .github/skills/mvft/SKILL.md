---
name: mvft
description: |
  最小可行族譜 (MVFT - Minimum Viable Family Tree) 定義與實作指引。
  當處理族譜圖數據結構、關鍵路徑 (Key Path) 計算、核心家庭單元 (EFU) 資料填充、
  節點擴張策略（完整擴張 vs 終端擴張）、兩個玩家之間的血緣關係計算、
  或程式碼中出現 MVFT、Key Path、Key Node、EFU、Terminal Node 等關鍵詞時，
  自動載入此 skill 提供完整的定義與實作指引。
---

# 最小可行族譜 (MVFT) Skill

## 概述

本 skill 提供完整的最小可行族譜 (MVFT - Minimum Viable Family Tree) 定義、實作模式與最佳實踐。

MVFT 是一套具備**「橫向寬度」但限制「旁系深度」**的族譜動態生長邏輯，確保核心家庭成員資訊完整，同時防止非必要資料的無限發散。

---

## 核心術語定義

### 關鍵路徑 (Key Path)

連結任意兩位參與玩家（Players）之間的邏輯血緣路徑。

**實作方式：**

```typescript
// 使用圖論演算法（BFS/DFS）尋找兩個節點之間的路徑
function findKeyPath(playerA: Player, playerB: Player): Node[] {
  // 路徑應包含起點、終點及所有中間節點
  // 通常尋找最短路徑
}
```

### 關鍵節點 (Key Node)

位於關鍵路徑上的所有節點，包含：

- 起始玩家 (Player A)
- 終點玩家 (Player B)
- 共同祖先 (Common Ancestor)
- 路徑中間的所有直系節點

**數據結構：**

```typescript
interface KeyNode {
  id: string;
  name: string;
  gender: "M" | "F";
  isPlayer: boolean;
  isKeyNode: boolean;
  expansionType: "FULL" | "TERMINAL"; // 關鍵節點必須 FULL
}
```

### 核心家庭單元 (Essential Family Unit, EFU)

由「一組配偶（父母）」及其「所有直系子女」組成的最小圖形結構。

```typescript
interface EFU {
  parents: [Node, Node]; // 父母配偶
  children: Node[]; // 所有子女（不可遺漏）
}
```

### 完整擴張 (Full Expansion)

針對節點執行三個維度的資料填充：

1. **向上追溯父母**
2. **橫向連結配偶**
3. **向下補全所有子女**

**適用對象：** 所有關鍵節點必須完整擴張

### 終端擴張 (Terminal Expansion / Leaf Node)

僅填寫「姓名」與「性別」，不進行任何維度的延伸追蹤。

**適用對象：** 非關鍵路徑上的手足節點

**關鍵限制：**

- ❌ 嚴禁詢問配偶
- ❌ 嚴禁詢問子女
- ✅ 僅填寫基本身份資訊

---

## MVFT 兩大判定原則

### 原則一：關鍵節點之核心家庭完整化

凡是關鍵節點，其所屬的 EFU 必須達成完整擴張：

1. ✅ **父母連結** - 確認父、母資訊（姓名與性別）
2. ✅ **配偶連結** - 確認法定或血緣配偶
3. ✅ **手足補全** - 確認父母下的「所有子女」

**檢查函式：**

```typescript
function validateKeyNodeEFU(node: KeyNode): boolean {
  return (
    hasParents(node) && // 有父母
    hasSpouse(node) && // 有配偶（如已婚）
    allSiblingsKnown(node) // 所有手足已知
  );
}
```

### 原則二：非關鍵路徑之終端限制

為滿足「手足補全」而產生的、不在關鍵路徑上的手足節點 → 定義為終端節點

**終端節點規則：**

```typescript
function isTerminalNode(node: Node, keyPath: Node[]): boolean {
  return !keyPath.includes(node) && node.expansionType === "TERMINAL";
}

function shouldStopExpansion(node: Node): boolean {
  return (
    isTerminalNode(node) &&
    (node.spouse !== null || // 已有配偶 → 停止
      node.children.length > 0) // 已有子女 → 停止
  );
}
```

---

## 實作範例：姪女（A）與姑姑（B）

### Step 1：確立關鍵路徑

```typescript
// 路徑: [玩家 A] → [父親] → [祖父母] ← [玩家 B]
const keyPath = findKeyPath(playerA, playerB);
// 結果: [playerA, father, grandfather, grandmother, playerB]

const keyNodes = new Set(keyPath);
```

### Step 2：執行關鍵節點的完整家庭擴張

#### 父親的 EFU

- 補全：父親的配偶（母親）、父親的所有子女
- 狀態：玩家 A 的所有手足 → 標記為 `TERMINAL`

#### 祖父母的 EFU

- 補全：祖父與祖母的配偶關係、所有子女（父親、姑姑 B、其他伯叔姑）
- 狀態：其他伯叔姑 → 標記為 `TERMINAL`

#### 姑姑 B 的 EFU

- 補全：姑姑 B 的配偶（姑丈）、所有子女（表手足）
- 狀態：姑丈與表手足 → 標記為 `TERMINAL`

**實作程式碼：**

```typescript
function expandKeyNode(node: KeyNode, keyNodes: Set<Node>) {
  // 1. 補全父母
  if (!node.father) node.father = createNode({ isKeyNode: false });
  if (!node.mother) node.mother = createNode({ isKeyNode: false });

  // 2. 補全配偶
  if (!node.spouse && node.isMarried) {
    node.spouse = createNode({
      expansionType: node.isKeyNode ? "FULL" : "TERMINAL",
    });
  }

  // 3. 補全所有子女
  const allChildren = getAllChildrenOfParents(node.father, node.mother);
  allChildren.forEach((child) => {
    if (!keyNodes.has(child)) {
      child.expansionType = "TERMINAL"; // 非關鍵路徑手足
    }
  });
}
```

### Step 3：套用終端限制（剪枝）

```typescript
function shouldAskForSpouse(node: Node): boolean {
  return !isTerminalNode(node);
}

function shouldAskForChildren(node: Node): boolean {
  return !isTerminalNode(node);
}
```

- ❌ 不再詢問「表手足」的配偶或小孩
- ❌ 不再詢問「伯叔姑」的配偶或小孩

---

## 任務派發優先級

資料填充任務應遵循以下優先級順序：

```typescript
enum TaskPriority {
  LEVEL_1_PATH_CLOSURE = 1, // 路徑閉合
  LEVEL_2_LATERAL_COMPLETION = 2, // 橫向補齊
  LEVEL_3_ATTRIBUTE_FILLING = 3, // 屬性填充
}
```

### Level 1：路徑閉合

優先完成連結 A 與 B 的直接垂直與水平節點（父親、祖父母）

### Level 2：橫向補齊

完成關鍵節點的配偶與手足

### Level 3：屬性填充

關鍵節點的生日、年紀與其他細節資訊

**任務生成器：**

```typescript
function generateFillTasks(keyPath: Node[]): DataFillTask[] {
  const tasks: DataFillTask[] = [];

  // Level 1: 確保路徑上所有節點都有父母
  keyPath.forEach((node) => {
    if (!node.father) {
      tasks.push({
        priority: TaskPriority.LEVEL_1_PATH_CLOSURE,
        nodeId: node.id,
        taskType: "PARENT",
      });
    }
  });

  // Level 2: 補全配偶與手足
  keyPath.forEach((node) => {
    if (!node.spouse && node.isMarried) {
      tasks.push({
        priority: TaskPriority.LEVEL_2_LATERAL_COMPLETION,
        nodeId: node.id,
        taskType: "SPOUSE",
      });
    }
  });

  // Level 3: 屬性資訊
  // ...

  return tasks.sort((a, b) => a.priority - b.priority);
}
```

---

## 常見實作模式

### 模式 1：節點標記系統

```typescript
interface FamilyNode {
  id: string;
  name: string;
  gender: "M" | "F";

  // MVFT 標記
  isPlayer: boolean;
  isOnKeyPath: boolean;
  expansionType: "FULL" | "TERMINAL";

  // 關係連結
  father?: FamilyNode;
  mother?: FamilyNode;
  spouse?: FamilyNode;
  children: FamilyNode[];
}
```

### 模式 2：擴張策略判斷

```typescript
function determineExpansionStrategy(
  node: FamilyNode,
  keyPath: FamilyNode[],
): "FULL" | "TERMINAL" {
  if (keyPath.includes(node)) {
    return "FULL"; // 關鍵節點 → 完整擴張
  }
  return "TERMINAL"; // 非關鍵路徑 → 終端擴張
}
```

### 模式 3：任務生成系統

```typescript
class MVFTTaskGenerator {
  generateTasks(playerA: Player, playerB: Player): Task[] {
    // 1. 找出關鍵路徑
    const keyPath = this.findKeyPath(playerA, playerB);

    // 2. 標記關鍵節點
    keyPath.forEach((node) => (node.isOnKeyPath = true));

    // 3. 生成填充任務
    const tasks = this.generateFillTasks(keyPath);

    // 4. 按優先級排序
    return this.sortByPriority(tasks);
  }
}
```

---

## 開發時的常見錯誤

### ❌ 錯誤 1：對終端節點進行擴張

```typescript
// 錯誤示範
if (node.expansionType === "TERMINAL") {
  askForSpouse(node); // ❌ 不應詢問配偶
  askForChildren(node); // ❌ 不應詢問子女
}

// 正確做法
if (node.expansionType === "TERMINAL") {
  // 僅收集姓名與性別，不進行擴張
  return { name: node.name, gender: node.gender };
}
```

### ❌ 錯誤 2：未正確標記關鍵路徑

```typescript
// 錯誤：遺漏中間節點
const keyPath = [playerA, commonAncestor, playerB]; // ❌ 漏掉中間節點

// 正確：包含所有路徑節點
const keyPath = [playerA, father, grandfather, grandmother, playerB];
```

### ❌ 錯誤 3：手足補全不完整

```typescript
// 錯誤：只取部分子女
const children = getFirstNChildren(father, mother, 3); // ❌

// 正確：取得所有子女
const children = getAllChildrenOfParents(father, mother); // ✅
```

### ❌ 錯誤 4：未按優先級順序執行任務

```typescript
// 錯誤：隨機執行任務
tasks.forEach((task) => executeTask(task)); // ❌

// 正確：按優先級排序後執行
tasks
  .sort((a, b) => a.priority - b.priority)
  .forEach((task) => executeTask(task)); // ✅
```

### ❌ 錯誤 5：過度擴展非關鍵節點

```typescript
// 錯誤：對所有節點都進行完整擴張
allNodes.forEach((node) => fullExpansion(node)); // ❌

// 正確：只對關鍵節點完整擴張
keyNodes.forEach((node) => fullExpansion(node));
nonKeyNodes.forEach((node) => terminalExpansion(node)); // ✅
```

---

## 測試建議

```typescript
describe("MVFT Implementation", () => {
  test("關鍵節點必須完整擴張", () => {
    const node = createKeyNode();
    expect(node.father).toBeDefined();
    expect(node.mother).toBeDefined();
    expect(node.spouse).toBeDefined();
  });

  test("終端節點不應有配偶資訊", () => {
    const terminalNode = createTerminalNode();
    expect(terminalNode.spouse).toBeUndefined();
    expect(terminalNode.children).toHaveLength(0);
  });

  test("手足必須完整補全", () => {
    const father = createNode();
    const mother = createNode();
    const siblings = getAllChildren(father, mother);

    // 確保所有子女都被找到
    expect(siblings.length).toBeGreaterThanOrEqual(2);
    expect(siblings).toContain(playerA);
  });

  test("關鍵路徑必須正確計算", () => {
    const path = findKeyPath(niece, aunt);

    expect(path).toContain(niece); // 姪女
    expect(path).toContain(father); // 父親
    expect(path).toContain(grandfather); // 祖父
    expect(path).toContain(grandmother); // 祖母
    expect(path).toContain(aunt); // 姑姑
  });

  test("任務優先級正確排序", () => {
    const tasks = generateFillTasks(keyPath);

    expect(tasks[0].priority).toBe(TaskPriority.LEVEL_1_PATH_CLOSURE);
    expect(tasks[tasks.length - 1].priority).toBe(
      TaskPriority.LEVEL_3_ATTRIBUTE_FILLING,
    );
  });
});
```

---

## 核心設計原則總結

### ✅ 確保的事項

- 每一位核心家庭成員在視覺呈現時不會缺席
- 關鍵路徑上的節點資訊完整
- 手足關係完整呈現（滿足 EFU 定義）

### ❌ 防止的事項

- 非必要資料的無限發散
- 旁系親屬的過度擴展
- 資料填充任務的失控成長

---

## 相關專案文件

- 原始定義文件：`/mvft.md`
- 系統指令：`/SYSTEM_INSTRUCTIONS.md`
- 實作階段說明：`/STAGE1_IMPLEMENTATION.md`
- 連線規格：`/CONNECTION_SPEC.md`
- 出題策略（Phase 2）：`/docs/features/qa_phase2_data_filling.md`
- 任務管理技術細節：`/docs/technical/task-management.md`
- WebSocket 事件：`/docs/technical/websocket-protocol.md`

---

**Skill 版本**: 1.0  
**最後更新**: 2026-02-18  
**維護者**: Family Tree Game Project
