export class TreeBuilder {
    build(nodesMap, rootId) {
        // Resolve a flat node from Python trace map into a hierarchical node
        function resolveNode(id, parent = null) {
            const rawNode = nodesMap[id];
            if (!rawNode) return null;
            
            const node = {
                id: rawNode.id,
                name: rawNode.name,
                args: rawNode.args,
                shortLabel: rawNode.short_label,
                label: rawNode.label,
                returnValue: rawNode.return_value,
                children: [],
                parent: parent,
                state: 'unvisited',
                x: 0,
                y: 0
            };
            
            for (let childId of rawNode.children) {
                const child = resolveNode(childId, node);
                if (child) {
                    node.children.push(child);
                }
            }
            return node;
        }
        
        const root = resolveNode(rootId);
        if (!root) return null;
        
        // Layout calculation (Leaf-based layout)
        let nextX = 0;
        const levelHeight = 150;
        const leafGap = 220;
        
        function calculateLayout(node, depth = 0) {
            node.y = depth * levelHeight + 60;
            if (node.children.length === 0) {
                node.x = nextX;
                nextX += leafGap;
            } else {
                for (let child of node.children) {
                    calculateLayout(child, depth + 1);
                }
                const firstChildX = node.children[0].x;
                const lastChildX = node.children[node.children.length - 1].x;
                node.x = (firstChildX + lastChildX) / 2;
            }
        }
        
        calculateLayout(root);
        
        // Return root and total width/height for SVG sizing
        return {
            root,
            width: nextX > 0 ? nextX - leafGap + 120 : 120, // Add margins
            height: getMaxDepth(root) * levelHeight + 120
        };
    }
}

function getMaxDepth(node) {
    if (!node.children || node.children.length === 0) return 0;
    return 1 + Math.max(...node.children.map(getMaxDepth));
}
