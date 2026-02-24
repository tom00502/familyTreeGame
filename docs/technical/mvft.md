# MVFT 技術實作指南

本檔案涵蓋 MVFT（最小可行族譜）的所有程式碼實作細節。概念說明請見 [concepts/mvft.md](../concepts/mvft.md)。

---

## 數據結構定義

### 關鍵節點接口

```typescript
interface KeyNode {
  id: string;
  name: string;
  gender: "M" | "F";
  isPlayer: boolean;
  isKeyNode: boolean;
  expansionType: "FULL"; // 關鍵節點必須完整擴張
}
```

### 完整族譜節點接口

```typescript
interface FamilyNode {
  // 身份信息
  id: string;
  name: string;
  gender: "M" | "F";
  birthday?: string;

  // MVFT 標記
  isPlayer: boolean; // 是否為玩家
  isOnKeyPath: boolean; // 是否在關鍵路徑上
  expansionType: "FULL" | "TERMINAL"; // 擴張類型

  // 關係連結
  father?: FamilyNode;
  mother?: FamilyNode;
  spouse?: FamilyNode;
  children: FamilyNode[];
}
```

### 任務優先級定義

```typescript
enum TaskPriority {
  LEVEL_1_PATH_CLOSURE = 1, // 路徑閉合
  LEVEL_2_LATERAL_COMPLETION = 2, // 橫向補齊
  LEVEL_3_ATTRIBUTE_FILLING = 3, // 屬性填充
}

interface DataFillTask {
  priority: TaskPriority;
  nodeId: string;
  taskType: "PARENT" | "SPOUSE" | "CHILDREN" | "ATTRIBUTE";
}
```

---

## 常見實作模式

### 模式 1：擴張策略判斷

決定節點應該採用完整擴張還是終端擴張：

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

### 模式 2：驗證關鍵節點完整性

```typescript
function isKeyNodeComplete(node: KeyNode): boolean {
  return (
    hasParents(node) && // 有父母
    hasSpouse(node) && // 有配偶（如需）
    allSiblingsKnown(node) // 所有手足已知
  );
}

function hasParents(node: FamilyNode): boolean {
  return node.father !== undefined && node.mother !== undefined;
}

function hasSpouse(node: FamilyNode): boolean {
  if (!node.isPlayer) return true; // 非玩家節點可無配偶
  return node.spouse !== undefined || !node.isMarried;
}

function allSiblingsKnown(node: FamilyNode): boolean {
  if (!node.father || !node.mother) return false;
  const siblings = getAllChildrenOfParents(node.father, node.mother);
  return siblings.length > 0;
}
```

### 模式 3：終端節點限制檢查

檢查是否應該詢問某個節點的親屬資訊：

```typescript
function isTerminalNode(node: FamilyNode, keyPath: FamilyNode[]): boolean {
  return !keyPath.includes(node) && node.expansionType === "TERMINAL";
}

function shouldAskForSpouse(node: FamilyNode): boolean {
  return !isTerminalNode(node);
}

function shouldAskForChildren(node: FamilyNode): boolean {
  return !isTerminalNode(node);
}

function shouldStopExpansion(node: FamilyNode): boolean {
  return (
    isTerminalNode(node) &&
    (node.spouse !== undefined || node.children.length > 0)
  );
}
```

### 模式 4：MVFT 全局驗證

```typescript
function validateMVFT(keyNodes: FamilyNode[]): boolean {
  return keyNodes.every((node) => {
    // 所有關鍵節點必須有父母
    if (!node.father || !node.mother) {
      console.warn(`Key node ${node.id} missing parents`);
      return false;
    }

    // 所有手足必須被找到
    const siblings = getAllSiblings(node);
    if (siblings.length === 0) {
      console.warn(`Key node ${node.id} has no siblings`);
      return false;
    }

    // 配偶關係必須完整（如已婚）
    if (node.spouse && !node.spouse.spouse) {
      console.warn(`Spouse relationship incomplete for node ${node.id}`);
      return false;
    }

    return true;
  });
}

function getAllSiblings(node: FamilyNode): FamilyNode[] {
  if (!node.father || !node.mother) return [];
  const allChildren = getAllChildrenOfParents(node.father, node.mother);
  return allChildren.filter((child) => child.id !== node.id);
}
```

### 模式 5：任務生成系統

```typescript
class MVFTTaskGenerator {
  generateTasks(playerA: FamilyNode, playerB: FamilyNode): DataFillTask[] {
    // 1. 找出關鍵路徑
    const keyPath = this.findKeyPath(playerA, playerB);
    if (!keyPath) {
      console.error("No path found between players");
      return [];
    }

    // 2. 標記關鍵節點
    const keyNodes = new Set(keyPath);
    keyPath.forEach((node) => {
      node.isOnKeyPath = true;
      node.expansionType = "FULL";
    });

    // 3. 生成填充任務
    const tasks = this.generateFillTasks(keyPath);

    // 4. 按優先級排序
    return this.sortByPriority(tasks);
  }

  private findKeyPath(start: FamilyNode, end: FamilyNode): FamilyNode[] | null {
    // BFS 或 DFS 實作
    // 返回從 start 到 end 的最短路徑
    const path: FamilyNode[] = [];
    const visited = new Set<string>();

    const dfs = (current: FamilyNode): boolean => {
      if (current.id === end.id) {
        path.push(current);
        return true;
      }

      visited.add(current.id);

      // 向上查詢（父母）
      if (current.father && !visited.has(current.father.id)) {
        path.push(current.father);
        if (dfs(current.father)) return true;
        path.pop();
      }

      if (current.mother && !visited.has(current.mother.id)) {
        path.push(current.mother);
        if (dfs(current.mother)) return true;
        path.pop();
      }

      // 向下查詢（配偶、子女）
      if (current.spouse && !visited.has(current.spouse.id)) {
        path.push(current.spouse);
        if (dfs(current.spouse)) return true;
        path.pop();
      }

      current.children.forEach((child) => {
        if (!visited.has(child.id)) {
          path.push(child);
          if (dfs(child)) return;
          path.pop();
        }
      });

      return false;
    };

    path.push(start);
    return dfs(start) ? path.reverse() : null;
  }

  private generateFillTasks(keyPath: FamilyNode[]): DataFillTask[] {
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
      if (!node.mother) {
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

      // 補全所有手足
      if (node.father && node.mother) {
        const siblings = getAllChildrenOfParents(node.father, node.mother);
        siblings.forEach((sibling) => {
          if (!sibling.name) {
            tasks.push({
              priority: TaskPriority.LEVEL_2_LATERAL_COMPLETION,
              nodeId: sibling.id,
              taskType: "PARENT", // 實際上是要填寫手足信息
            });
          }
        });
      }
    });

    // Level 3: 屬性資訊
    keyPath.forEach((node) => {
      if (!node.birthday) {
        tasks.push({
          priority: TaskPriority.LEVEL_3_ATTRIBUTE_FILLING,
          nodeId: node.id,
          taskType: "ATTRIBUTE",
        });
      }
    });

    return tasks;
  }

  private sortByPriority(tasks: DataFillTask[]): DataFillTask[] {
    return tasks.sort((a, b) => a.priority - b.priority);
  }
}
```

---

## 開發時的常見錯誤與修正

### ❌ 錯誤 1：對終端節點進行擴張

**問題**：詢問終端節點的配偶或子女

```typescript
// 錯誤做法
function populateNodeData(node: FamilyNode) {
  if (node.expansionType === "TERMINAL") {
    askForSpouse(node); // ❌ 不應詢問
    askForChildren(node); // ❌ 不應詢問
  }
}
```

**正確做法**：

```typescript
function populateNodeData(node: FamilyNode) {
  if (node.expansionType === "TERMINAL") {
    // 僅收集基本信息
    node.name = getUserInput("姓名");
    node.gender = getUserInput("性別");
    // 不填充其他維度
    return;
  }

  // FULL 擴張才詢問其他信息
  if (node.expansionType === "FULL") {
    node.father = getOrCreateNode(getUserInput("父親"));
    node.mother = getOrCreateNode(getUserInput("母親"));
    node.spouse = getOrCreateNode(getUserInput("配偶"));
    node.children = getOrCreateNodes(getUserInput("所有子女"));
  }
}
```

### ❌ 錯誤 2：未正確標記關鍵路徑

**問題**：路徑中遺漏中間節點

```typescript
// 錯誤
const keyPath = [playerA, commonAncestor, playerB]; // 遺漏中間節點

// 正確：必須包含所有路徑節點
const keyPath = [
  playerA,
  playerA.father,
  playerA.grandfather,
  playerA.grandmother,
  aunts[0], // 玩家 B
];
```

### ❌ 錯誤 3：手足補全不完整

**問題**：只取得部分子女

```typescript
// 錯誤
const children = node.children.slice(0, 3); // 只取前 3 個

// 正確
const children = getAllChildrenOfParents(node.father, node.mother); // 全部
```

**關鍵點**：不能依賴已知的子女列表，必須從父母的角度查詢所有子女。

```typescript
function getAllChildrenOfParents(
  father: FamilyNode,
  mother: FamilyNode,
): FamilyNode[] {
  const childrenSet = new Set<string>();
  const children: FamilyNode[] = [];

  // 從父親的角度
  father.children.forEach((child) => {
    if (!childrenSet.has(child.id)) {
      childrenSet.add(child.id);
      children.push(child);
    }
  });

  // 從母親的角度
  mother.children.forEach((child) => {
    if (!childrenSet.has(child.id)) {
      childrenSet.add(child.id);
      children.push(child);
    }
  });

  return children;
}
```

### ❌ 錯誤 4：過度擴展非關鍵節點

**問題**：對所有節點都進行完整擴張

```typescript
// 錯誤
allNodes.forEach((node) => {
  fullExpansion(node); // 所有節點都完整擴張
});

// 正確
keyNodes.forEach((node) => fullExpansion(node)); // 僅關鍵節點
nonKeyNodes.forEach((node) => terminalExpansion(node)); // 非關鍵終端
```

### ❌ 錯誤 5：忽視 EFU 完整性

**問題**：未確保核心家庭單元的完整性

```typescript
// 錯誤
node.children = [knownChild1, knownChild2]; // 只記錄已知的

// 正確
node.children = getAllChildrenOfParents(node.father, node.mother);
// 確保包含所有子女，即使之前未被提及
```

### ❌ 錯誤 6：配偶關係單向維護

**問題**：只在一方記錄配偶

```typescript
// 錯誤
playerA.spouse = playerB;
// playerB.spouse 沒有反向設定

// 正確
function linkSpouses(spouse1: FamilyNode, spouse2: FamilyNode) {
  spouse1.spouse = spouse2;
  spouse2.spouse = spouse1; // 雙向維護關係
}
```

---

## 測試建議

### 單元測試

```typescript
describe("MVFT 實作驗證", () => {
  let playerA: FamilyNode;
  let playerB: FamilyNode;
  let keyPath: FamilyNode[];

  beforeEach(() => {
    // 設置測試數據
    playerA = createPlayer("A", "F", "niece");
    playerB = createPlayer("B", "F", "aunt");
    keyPath = [playerA /* father */ /* grandfather */, , , playerB];
  });

  describe("關鍵節點擴張", () => {
    test("✅ 關鍵節點必須有父母", () => {
      keyPath.forEach((node) => {
        if (node.isOnKeyPath) {
          expect(node.father).toBeDefined();
          expect(node.mother).toBeDefined();
        }
      });
    });

    test("✅ 關鍵節點必須有配偶（如已婚）", () => {
      const father = playerA.father;
      if (father.isMarried) {
        expect(father.spouse).toBeDefined();
      }
    });

    test("✅ 關鍵節點的手足必須完整", () => {
      const father = playerA.father;
      const allChildren = getAllChildrenOfParents(father.father, father.mother);
      expect(allChildren.length).toBeGreaterThan(0);
    });
  });

  describe("終端節點限制", () => {
    test("✅ 終端節點不應詢問配偶", () => {
      const terminalNode = createNode();
      terminalNode.expansionType = "TERMINAL";
      expect(shouldAskForSpouse(terminalNode)).toBe(false);
    });

    test("✅ 終端節點不應詢問子女", () => {
      const terminalNode = createNode();
      terminalNode.expansionType = "TERMINAL";
      expect(shouldAskForChildren(terminalNode)).toBe(false);
    });

    test("✅ 終端節點只有基本屬性", () => {
      const terminalNode = createNode();
      terminalNode.expansionType = "TERMINAL";
      terminalNode.name = "終端";
      terminalNode.gender = "M";

      expect(terminalNode.father).toBeUndefined();
      expect(terminalNode.spouse).toBeUndefined();
      expect(terminalNode.children).toHaveLength(0);
    });
  });

  describe("路徑計算", () => {
    test("✅ 關鍵路徑必須連結兩位玩家", () => {
      const generator = new MVFTTaskGenerator();
      const path = generator["findKeyPath"](playerA, playerB);

      expect(path).toBeDefined();
      expect(path[0]).toBe(playerA);
      expect(path[path.length - 1]).toBe(playerB);
    });

    test("✅ 關鍵路徑不應有間隙", () => {
      const generator = new MVFTTaskGenerator();
      const path = generator["findKeyPath"](playerA, playerB);

      for (let i = 0; i < path.length - 1; i++) {
        const current = path[i];
        const next = path[i + 1];

        // 驗證相鄰節點存在血緣關係
        const isRelated =
          isParentChild(current, next) || isParentChild(next, current);

        expect(isRelated).toBe(true);
      }
    });
  });

  describe("任務派發", () => {
    test("✅ 任務按優先級排序", () => {
      const generator = new MVFTTaskGenerator();
      const tasks = generator.generateTasks(playerA, playerB);

      for (let i = 0; i < tasks.length - 1; i++) {
        expect(tasks[i].priority).toBeLessThanOrEqual(tasks[i + 1].priority);
      }
    });

    test("✅ Level 1 任務優先於 Level 2", () => {
      const generator = new MVFTTaskGenerator();
      const tasks = generator.generateTasks(playerA, playerB);

      const level1Tasks = tasks.filter(
        (t) => t.priority === TaskPriority.LEVEL_1_PATH_CLOSURE,
      );
      const level2Tasks = tasks.filter(
        (t) => t.priority === TaskPriority.LEVEL_2_LATERAL_COMPLETION,
      );

      const lastLevel1Index = tasks.lastIndexOf(
        level1Tasks[level1Tasks.length - 1],
      );
      const firstLevel2Index = tasks.indexOf(level2Tasks[0]);

      expect(lastLevel1Index).toBeLessThan(firstLevel2Index);
    });
  });

  describe("MVFT 驗證", () => {
    test("✅ 完整的 MVFT 應通過驗證", () => {
      const completeKeyNodes = buildCompleteMVFT();
      const isValid = validateMVFT(completeKeyNodes);

      expect(isValid).toBe(true);
    });

    test("❌ 不完整的 MVFT 應驗證失敗", () => {
      const incompleteKeyNodes = buildIncompleteMVFT();
      const isValid = validateMVFT(incompleteKeyNodes);

      expect(isValid).toBe(false);
    });

    test("✅ EFU 必須包含所有子女", () => {
      const father = createNode();
      const mother = createNode();
      father.spouse = mother;
      mother.spouse = father;

      // 手動添加子女
      const child1 = createNode();
      const child2 = createNode();
      father.children = [child1, child2];
      mother.children = [child1, child2];

      // 驗證 EFU 完整性
      const allChildren = getAllChildrenOfParents(father, mother);
      expect(allChildren).toContain(child1);
      expect(allChildren).toContain(child2);
      expect(allChildren.length).toBe(2);
    });
  });
});
```

### 集成測試

```typescript
describe("MVFT 端到端流程", () => {
  test("姪女（A）與姑姑（B）的完整 MVFT 生成", () => {
    // 1. 建立玩家
    const niece = createPlayer("玩家A", "F");
    const aunt = createPlayer("玩家B", "F");

    // 2. 生成關鍵路徑
    const generator = new MVFTTaskGenerator();
    const keyPath = generator["findKeyPath"](niece, aunt);

    expect(keyPath).toBeDefined();

    // 3. 生成填充任務
    const tasks = generator.generateTasks(niece, aunt);

    expect(tasks.length).toBeGreaterThan(0);
    expect(tasks[0].priority).toBe(TaskPriority.LEVEL_1_PATH_CLOSURE);

    // 4. 執行任務（模擬用戶輸入）
    tasks.forEach((task) => {
      executeTask(task, mockUserResponses);
    });

    // 5. 驗證 MVFT 完整性
    const keyNodes = keyPath.map((n) => n as KeyNode);
    const isValid = validateMVFT(keyNodes);

    expect(isValid).toBe(true);
  });
});
```

---

## 效能相關建議

### 路徑查詢優化

```typescript
// 使用記憶化避免重複計算
class PathFinder {
  private cache = new Map<string, FamilyNode[]>();

  findKeyPath(start: FamilyNode, end: FamilyNode): FamilyNode[] | null {
    const cacheKey = `${start.id}-${end.id}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const path = this.calculatePath(start, end);
    this.cache.set(cacheKey, path);

    return path;
  }

  private calculatePath(start: FamilyNode, end: FamilyNode): FamilyNode[] {
    // BFS 實作...
  }

  invalidateCache() {
    this.cache.clear();
  }
}
```

### 任務去重

```typescript
function deduplicateTasks(tasks: DataFillTask[]): DataFillTask[] {
  const seen = new Map<string, DataFillTask>();

  tasks.forEach((task) => {
    const key = `${task.nodeId}-${task.taskType}`;
    if (!seen.has(key) || seen.get(key).priority > task.priority) {
      seen.set(key, task);
    }
  });

  return Array.from(seen.values());
}
```

---

## 相關概念文件

- MVFT 概念說明：[concepts/mvft.md](../concepts/mvft.md)
- 資料填充策略：[features/qa_phase2_data_filling.md](../features/qa_phase2_data_filling.md)

---

**文件版本**：1.0  
**最後更新**：2026-02-24  
**維護者**：Family Tree Game Project
