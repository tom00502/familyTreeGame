import dagre from 'dagre'

export const useFamilyLayout = () => {
  const applyLayout = (nodes, edges) => {
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir: 'TB', nodesep: 80, ranksep: 100 })
    g.setDefaultEdgeLabel(() => ({}))

    nodes.forEach(n => g.setNode(n.id, { width: 150, height: 60 }))
    edges.forEach(e => g.setEdge(e.source, e.target))

    dagre.layout(g)

    return nodes.map(n => {
      const pos = g.node(n.id)
      return { ...n, position: { x: pos.x - 75, y: pos.y - 30 } }
    })
  }

  return { applyLayout }
}
