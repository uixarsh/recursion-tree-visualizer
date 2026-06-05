export class TreeRenderer {
    constructor(svgElementId) {
        this.svg = document.getElementById(svgElementId);
        // Create inner group for transforms
        this.g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        this.svg.appendChild(this.g);

        // Zoom and Pan state
        this.zoomLevel = 1.0;
        this.panX = 0;
        this.panY = 0;
        this.isDragging = false;
        this.startX = 0;
        this.startY = 0;

        this.setupZoomPan();
    }

    setupZoomPan() {
        this.svg.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            this.isDragging = true;
            this.startX = e.clientX - this.panX;
            this.startY = e.clientY - this.panY;
            this.svg.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            this.panX = e.clientX - this.startX;
            this.panY = e.clientY - this.startY;
            this.updateTransform();
        });

        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.svg.style.cursor = 'grab';
            }
        });

        this.svg.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomFactor = 1.1;
            
            const rect = this.svg.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const beforeZoomX = (mouseX - this.panX) / this.zoomLevel;
            const beforeZoomY = (mouseY - this.panY) / this.zoomLevel;

            if (e.deltaY < 0) {
                this.zoomLevel *= zoomFactor;
            } else {
                this.zoomLevel /= zoomFactor;
            }
            
            this.zoomLevel = Math.max(0.1, Math.min(5.0, this.zoomLevel));

            this.panX = mouseX - beforeZoomX * this.zoomLevel;
            this.panY = mouseY - beforeZoomY * this.zoomLevel;

            this.updateTransform();
        }, { passive: false });
        
        this.svg.style.cursor = 'grab';
    }

    updateTransform() {
        this.g.setAttribute('transform', `translate(${this.panX}, ${this.panY}) scale(${this.zoomLevel})`);
    }

    resetZoom(treeWidth, treeHeight) {
        const svgRect = this.svg.getBoundingClientRect();
        const padding = 60;
        const scaleX = (svgRect.width - padding) / treeWidth;
        const scaleY = (svgRect.height - padding) / treeHeight;
        this.zoomLevel = Math.min(scaleX, scaleY, 1.0);
        
        this.panX = (svgRect.width - treeWidth * this.zoomLevel) / 2;
        this.panY = padding;
        this.updateTransform();
    }

    renderTree(treeData) {
        this.g.innerHTML = '';
        this.treeData = treeData;

        // Build node lookup map for state updates
        this.nodesMap = {};
        const mapNode = (n) => {
            this.nodesMap[n.id] = n;
            for (let child of n.children) {
                mapNode(child);
            }
        };
        mapNode(treeData.root);

        // Draw connections (edges) first
        this.drawEdges(treeData.root);

        // Draw nodes on top
        this.drawNodes(treeData.root);
    }

    getEdgeLabel(parentNode, childNode) {
        const parentArgs = parentNode.args || {};
        const childArgs = childNode.args || {};
        const diffs = [];
        for (const [k, v] of Object.entries(childArgs)) {
            // Compare stringified versions for arrays/dicts
            const parentValStr = typeof parentArgs[k] === 'object' ? JSON.stringify(parentArgs[k]) : String(parentArgs[k]);
            const childValStr = typeof v === 'object' ? JSON.stringify(v) : String(v);
            if (parentValStr !== childValStr) {
                diffs.push(`${k}=${childValStr}`);
            }
        }
        return diffs.join(', ');
    }

    drawEdges(node) {
        for (let child of node.children) {
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', node.x);
            line.setAttribute('y1', node.y);
            line.setAttribute('x2', child.x);
            line.setAttribute('y2', child.y);
            line.setAttribute('class', 'tree-edge');
            line.setAttribute('id', `edge-${node.id}-${child.id}`);
            this.g.appendChild(line);

            // Dynamic edge label
            const labelText = this.getEdgeLabel(node, child);
            if (labelText) {
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', (node.x + child.x) / 2);
                text.setAttribute('y', (node.y + child.y) / 2 - 8);
                text.setAttribute('class', 'edge-label');
                text.textContent = labelText;
                this.g.appendChild(text);
            }

            this.drawEdges(child);
        }
    }

    drawNodes(node) {
        const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        group.setAttribute('class', `tree-node-group`);
        group.setAttribute('id', `node-group-${node.id}`);

        // Tooltip for browser hover
        const titleTooltip = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        titleTooltip.textContent = `${node.label}${node.returnValue !== undefined && node.returnValue !== null ? ` -> ${node.returnValue}` : ''}`;
        group.appendChild(titleTooltip);

        // Node Circle
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('cx', node.x);
        circle.setAttribute('cy', node.y);
        circle.setAttribute('r', 24);
        circle.setAttribute('class', `tree-node state-unvisited`);
        circle.setAttribute('id', `node-circle-${node.id}`);
        group.appendChild(circle);

        // Node Text (short parameter representations inside circle)
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', node.x);
        text.setAttribute('y', node.y + 5);
        text.setAttribute('class', 'node-text');
        text.textContent = node.shortLabel;
        group.appendChild(text);

        // Node Label (full signature underneath)
        const arrayText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        arrayText.setAttribute('x', node.x);
        arrayText.setAttribute('y', node.y + 40);
        arrayText.setAttribute('class', 'node-array-text');
        arrayText.textContent = node.label;
        group.appendChild(arrayText);

        this.g.appendChild(group);

        for (let child of node.children) {
            this.drawNodes(child);
        }
    }

    updateStates(currentNodeId, nodeStates) {
        for (const [nodeId, state] of Object.entries(nodeStates)) {
            const circle = document.getElementById(`node-circle-${nodeId}`);
            if (circle) {
                circle.classList.remove('state-unvisited', 'state-active', 'state-success', 'state-pruned', 'state-visited');
                circle.classList.add(`state-${state}`);
            }

            const group = document.getElementById(`node-group-${nodeId}`);
            if (group) {
                if (parseInt(nodeId) === currentNodeId) {
                    group.classList.add('node-active-pulse');
                } else {
                    group.classList.remove('node-active-pulse');
                }

                // Update signature text to show return value once returned
                const arrayText = group.querySelector('.node-array-text');
                if (arrayText && this.nodesMap) {
                    const node = this.nodesMap[nodeId];
                    if (node) {
                        const hasReturned = state === 'visited' || state === 'success' || state === 'pruned';
                        if (hasReturned && node.returnValue !== undefined && node.returnValue !== null) {
                            arrayText.textContent = `${node.label} = ${node.returnValue}`;
                        } else {
                            arrayText.textContent = node.label;
                        }
                    }
                }
            }
        }

        // Highlight active edges
        if (this.treeData) {
            const highlightEdges = (node) => {
                for (let child of node.children) {
                    const edge = document.getElementById(`edge-${node.id}-${child.id}`);
                    if (edge) {
                        const childState = nodeStates[child.id];
                        edge.classList.remove('edge-active', 'edge-success', 'edge-pruned', 'edge-visited');

                        if (childState === 'active') {
                            edge.classList.add('edge-active');
                        } else if (childState === 'success') {
                            edge.classList.add('edge-success');
                        } else if (childState === 'pruned') {
                            edge.classList.add('edge-pruned');
                        } else if (childState === 'visited') {
                            edge.classList.add('edge-visited');
                        }
                    }
                    highlightEdges(child);
                }
            };
            highlightEdges(this.treeData.root);
        }
    }
}
