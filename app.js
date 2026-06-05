import { TreeBuilder } from './core/treeBuilder.js';
import { ExecutionEngine } from './core/engine.js';
import { TreeRenderer } from './ui/treeRenderer.js';
import { StackPanel } from './ui/stackPanel.js';
import { Inspector } from './ui/inspector.js';

const PYTHON_TRACER_CODE = `
import sys
import io
import json
import inspect

class Tracer:
    def __init__(self):
        self.steps = []
        self.nodes = {}
        self.node_id_counter = 0
        self.call_stack = []
        self.root_nodes = []
        self.node_states = {}

    def format_val(self, val):
        if isinstance(val, (int, float, str, bool)) or val is None:
            return val
        if isinstance(val, list):
            return [self.format_val(x) for x in val]
        if isinstance(val, dict):
            return {str(k): self.format_val(v) for k, v in val.items()}
        if isinstance(val, (set, tuple)):
            return [self.format_val(x) for x in val]
        return repr(val)

    def trace_calls(self, frame, event, arg):
        if frame.f_code.co_filename != '<string>' or frame.f_code.co_name == '<module>':
            return self.trace_calls

        func_name = frame.f_code.co_name
        line_no = frame.f_lineno

        # Extract locals
        locals_copy = {}
        for k, v in frame.f_locals.items():
            locals_copy[k] = self.format_val(v)

        if event == 'call':
            if len(self.steps) > 2000:
                raise RuntimeError("Recursion limit exceeded (max 2000 steps)")

            node_id = self.node_id_counter
            self.node_id_counter += 1
            
            parent_id = self.call_stack[-1] if self.call_stack else None
            
            arg_info = inspect.getargvalues(frame)
            args = {name: locals_copy.get(name, repr(frame.f_locals[name])) for name in arg_info.args}
            if arg_info.varargs:
                args[arg_info.varargs] = repr(frame.f_locals[arg_info.varargs])
            if arg_info.keywords:
                args[arg_info.keywords] = repr(frame.f_locals[arg_info.keywords])

            short_label = ", ".join(str(v) for k, v in args.items() if not isinstance(frame.f_locals[k], (list, dict, set)))
            if not short_label:
                short_label = "()"
            
            label = f"{func_name}({', '.join(f'{k}={v}' for k, v in args.items())})"

            node = {
                'id': node_id,
                'name': func_name,
                'args': args,
                'short_label': short_label,
                'label': label,
                'children': [],
                'parent_id': parent_id,
                'return_value': None,
                'has_returned': False
            }
            
            self.nodes[node_id] = node
            if parent_id is not None:
                self.nodes[parent_id]['children'].append(node_id)
            else:
                self.root_nodes.append(node_id)
                
            self.call_stack.append(node_id)
            self.node_states[node_id] = 'active'
            
            stack_labels = [self.nodes[nid]['label'] for nid in self.call_stack]

            self.steps.append({
                'event': 'call',
                'node_id': node_id,
                'line': line_no,
                'locals': locals_copy,
                'stack': stack_labels,
                'node_states': dict(self.node_states),
                'return_value': None
            })

        elif event == 'line':
            node_id = self.call_stack[-1] if self.call_stack else None
            if node_id is not None:
                self.node_states[node_id] = 'active'
                stack_labels = [self.nodes[nid]['label'] for nid in self.call_stack]
                self.steps.append({
                    'event': 'line',
                    'node_id': node_id,
                    'line': line_no,
                    'locals': locals_copy,
                    'stack': stack_labels,
                    'node_states': dict(self.node_states),
                    'return_value': None
                })

        elif event == 'return':
            node_id = self.call_stack[-1] if self.call_stack else None
            if node_id is not None:
                ret_val = repr(arg)
                self.nodes[node_id]['return_value'] = ret_val
                self.nodes[node_id]['has_returned'] = True
                
                state = 'visited'
                if arg is True:
                    state = 'success'
                elif arg is False:
                    state = 'pruned'
                
                self.node_states[node_id] = state
                stack_labels = [self.nodes[nid]['label'] for nid in self.call_stack]
                self.steps.append({
                    'event': 'return',
                    'node_id': node_id,
                    'line': line_no,
                    'locals': locals_copy,
                    'stack': stack_labels,
                    'node_states': dict(self.node_states),
                    'return_value': ret_val
                })
                self.call_stack.pop()

        return self.trace_calls

def run_and_trace(user_code, entry_call):
    import traceback
    tracer = Tracer()
    user_globals = {}
    
    stdout_redirect = io.StringIO()
    old_stdout = sys.stdout
    sys.stdout = stdout_redirect

    exception_str = None
    return_val = None
    try:
        exec(user_code, user_globals)
        sys.settrace(tracer.trace_calls)
        try:
            try:
                return_val = eval(entry_call, user_globals)
            except SyntaxError:
                exec(entry_call, user_globals)
        finally:
            sys.settrace(None)
    except Exception as e:
        exception_str = traceback.format_exc()
    finally:
        sys.stdout = old_stdout

    if exception_str and tracer.call_stack:
        for nid in tracer.call_stack:
            tracer.node_states[nid] = 'pruned'

    globals_filtered = {}
    for k, v in user_globals.items():
        if k.startswith('__') or inspect.ismodule(v) or k in ('sys', 'io', 'json', 'inspect', 'Tracer', 'run_and_trace'):
            continue
        globals_filtered[k] = tracer.format_val(v)

    for step in tracer.steps:
        step['globals'] = globals_filtered

    result = {
        'steps': tracer.steps,
        'nodes': tracer.nodes,
        'root_nodes': tracer.root_nodes,
        'stdout': stdout_redirect.getvalue(),
        'exception': exception_str,
        'returnValue': repr(return_val) if return_val is not None else None,
        'globals': globals_filtered
    }
    return json.dumps(result)
`;

const PRESETS = {
    'preset-fib': {
        code: `def fib(n):
    if n <= 1:
        return n
    return fib(n - 1) + fib(n - 2)
`,
        entry: 'fib(4)',
        time: 'O(2^N)',
        space: 'O(N)'
    },
    'preset-combsum': {
        code: `candidates = [2, 3, 5]
target = 8
results = []

def solve(idx, sum_val, curr):
    if sum_val == target:
        results.append(list(curr))
        return True # success (green)
    if sum_val > target:
        return False # pruned (red)
        
    for i in range(idx, len(candidates)):
        curr.append(candidates[i])
        solve(i, sum_val + candidates[i], curr)
        curr.pop()
`,
        entry: 'solve(0, 0, [])',
        time: 'O(N ^ (T/M))',
        space: 'O(T/M)'
    },
    'preset-subsets': {
        code: `nums = [1, 2, 3]
results = []

def subsets(idx, curr):
    if idx == len(nums):
        results.append(list(curr))
        return True
        
    # Exclude nums[idx]
    subsets(idx + 1, curr)
    
    # Include nums[idx]
    curr.append(nums[idx])
    subsets(idx + 1, curr)
    curr.pop()
`,
        entry: 'subsets(0, [])',
        time: 'O(2^N)',
        space: 'O(N)'
    },
    'preset-fact': {
        code: `def factorial(n):
    if n <= 1:
        return 1
    return n * factorial(n - 1)
`,
        entry: 'factorial(4)',
        time: 'O(N)',
        space: 'O(N)'
    },
    'preset-binsearch': {
        code: `arr = [1, 3, 5, 7, 9, 11, 13, 15]
target = 11

def binary_search(low, high):
    if low > high:
        return False
    mid = (low + high) // 2
    if arr[mid] == target:
        return True
    elif arr[mid] > target:
        return binary_search(low, mid - 1)
    else:
        return binary_search(mid + 1, high)
`,
        entry: 'binary_search(0, len(arr) - 1)',
        time: 'O(log N)',
        space: 'O(log N)'
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const runBtn = document.getElementById('run-btn');
    const presetSelect = document.getElementById('preset-select');
    const entryCallInput = document.getElementById('entry-call-input');
    
    const playBtn = document.getElementById('play-btn');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const resetBtn = document.getElementById('reset-btn');
    
    const speedSlider = document.getElementById('speed-slider');
    const speedVal = document.getElementById('speed-val');
    
    const timelineSlider = document.getElementById('timeline-slider');
    const timelineProgress = document.getElementById('timeline-progress');
    
    // Instantiate Core & UI
    const treeBuilder = new TreeBuilder();
    const engine = new ExecutionEngine();
    const renderer = new TreeRenderer('tree');
    const stackPanel = new StackPanel('stack-panel');
    const inspector = new Inspector('variables-panel', 'results-panel');

    // State Variables
    let currentTree = null;
    let pyodideInstance = null;
    let activeDecorations = [];
    let isCustomCode = false;

    // Hook engine events
    engine.onStepChange((snapshot, currentIndex, totalSteps) => {
        // Update timeline slider
        timelineSlider.max = totalSteps - 1;
        timelineSlider.value = currentIndex;
        timelineProgress.textContent = `${currentIndex + 1} / ${totalSteps}`;

        // Update SVG Tree States
        renderer.updateStates(snapshot.currentNodeId, snapshot.nodeStates);

        // Update Stack
        stackPanel.render(snapshot.stack);

        // Highlight Monaco Editor Line
        if (window.editor) {
            const line = snapshot.codeLine;
            activeDecorations = window.editor.deltaDecorations(activeDecorations, [
                {
                    range: new monaco.Range(line, 1, line, 1),
                    options: {
                        isWholeLine: true,
                        className: 'monaco-active-line',
                        marginClassName: 'monaco-active-line-margin'
                    }
                }
            ]);
            window.editor.revealLineInCenterIfOutsideViewport(line);
        }

        // Update Inspector (Variables)
        inspector.renderVariables(snapshot.inspector);
    });

    engine.onPlayStateChange((isPlaying) => {
        if (isPlaying) {
            playBtn.innerHTML = '<span class="material-icons">pause</span>';
            playBtn.classList.add('playing');
        } else {
            playBtn.innerHTML = '<span class="material-icons">play_arrow</span>';
            playBtn.classList.remove('playing');
        }
    });

    // Run visualization based on current inputs
    async function runVisualization() {
        if (!pyodideInstance || !window.editor) return;

        runBtn.disabled = true;
        const oldBtnHtml = runBtn.innerHTML;
        runBtn.innerHTML = '<span class="material-icons">hourglass_empty</span> Running...';

        const userCode = window.editor.getValue();
        const entryCall = entryCallInput.value.trim();

        if (!entryCall) {
            alert("Please enter a valid entry call expression (e.g. fib(4)).");
            runBtn.disabled = false;
            runBtn.innerHTML = oldBtnHtml;
            return;
        }

        try {
            // Inject variables into Pyodide namespace
            pyodideInstance.globals.set("user_code_str", userCode);
            pyodideInstance.globals.set("entry_call_str", entryCall);

            // Execute Python tracing runner
            const resultJson = await pyodideInstance.runPythonAsync(`run_and_trace(user_code_str, entry_call_str)`);
            const result = JSON.parse(resultJson);

            // Calculate measured max depth and total calls
            let maxDepth = 0;
            if (result.steps) {
                for (let step of result.steps) {
                    if (step.stack && step.stack.length > maxDepth) {
                        maxDepth = step.stack.length;
                    }
                }
            }
            const totalCalls = result.nodes ? Object.keys(result.nodes).length : 0;
            
            document.getElementById('measured-depth').textContent = maxDepth || '0';
            document.getElementById('measured-calls').textContent = totalCalls || '0';

            // Handle compilation/runtime exception
            const exception = result.exception;
            if (exception) {
                inspector.activeTab = 'console';
                const consoleBtn = document.getElementById('tab-console');
                const solutionsBtn = document.getElementById('tab-solutions');
                if (consoleBtn && solutionsBtn) {
                    consoleBtn.classList.add('active');
                    solutionsBtn.classList.remove('active');
                }
            }

            // Set console logs and statistics
            inspector.setConsoleData(result.stdout || '', exception, result.returnValue, result.steps.length);

            if (!result.root_nodes || result.root_nodes.length === 0) {
                if (!exception) {
                    alert("No function calls were executed. Verify that your entry call executes a function defined in the editor.");
                }
                runBtn.disabled = false;
                runBtn.innerHTML = oldBtnHtml;
                return;
            }

            // Build dynamic tree
            currentTree = treeBuilder.build(result.nodes, result.root_nodes[0]);

            // Render tree
            renderer.renderTree(currentTree);
            
            setTimeout(() => {
                renderer.resetZoom(currentTree.width, currentTree.height);
            }, 50);

            // Initialize execution engine
            engine.initialize(result.steps, currentTree.root);
            
            // Set solutions list
            let solutions = [];
            if (result.globals && Array.isArray(result.globals.results)) {
                solutions = result.globals.results.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x));
            } else if (result.globals && Array.isArray(result.globals.solutions)) {
                solutions = result.globals.solutions.map(x => typeof x === 'object' ? JSON.stringify(x) : String(x));
            } else {
                // Fallback success leaf collector
                const successNodes = [];
                const findSuccess = (node) => {
                    const rawNode = result.nodes[node.id];
                    if (rawNode && rawNode.return_value === 'True') {
                        successNodes.push(rawNode.label);
                    }
                    for (let childId of rawNode.children) {
                        findSuccess({ id: childId });
                    }
                };
                findSuccess({ id: result.root_nodes[0] });
                solutions = successNodes;
            }
            inspector.setSolutionsData(solutions);

            // Estimate complexity from tree structure if custom code
            if (isCustomCode && currentTree && currentTree.root) {
                let internalNodesCount = 0;
                let totalChildren = 0;
                
                const traverse = (node) => {
                    if (node.children && node.children.length > 0) {
                        internalNodesCount++;
                        totalChildren += node.children.length;
                        for (let child of node.children) {
                            traverse(child);
                        }
                    }
                };
                
                traverse(currentTree.root);
                
                const avgBranching = internalNodesCount > 0 ? (totalChildren / internalNodesCount) : 0;
                
                let timeEst = 'O(1)';
                let spaceEst = 'O(D) (Est.)';
                
                if (avgBranching > 0) {
                    if (avgBranching <= 1.05) {
                        timeEst = 'O(D) (Est. Linear)';
                    } else {
                        const b = avgBranching.toFixed(1);
                        timeEst = `O(${b}^D) (Est. Exp.)`;
                    }
                }
                
                document.getElementById('time-complexity').textContent = timeEst;
                document.getElementById('space-complexity').textContent = spaceEst;
            }

            updateEngineSpeed();

        } catch (err) {
            console.error("Tracing error:", err);
            alert("An error occurred during tracing: " + err.message);
        } finally {
            runBtn.disabled = false;
            runBtn.innerHTML = oldBtnHtml;
        }
    }

    function updateEngineSpeed() {
        const val = parseInt(speedSlider.value);
        const delay = Math.round(2000 - (val - 1) * (1900 / 9));
        engine.setSpeed(delay);
        speedVal.textContent = `${delay}ms`;
    }

    // Initialize Monaco and Pyodide
    require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function() {
        window.editor = monaco.editor.create(document.getElementById('editor-container'), {
            value: PRESETS['preset-combsum'].code,
            language: 'python',
            theme: 'vs-dark',
            automaticLayout: true,
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
        });

        // Initialize entry call statement value
        entryCallInput.value = PRESETS['preset-combsum'].entry;

        // Initialize complexity fields
        document.getElementById('time-complexity').textContent = PRESETS['preset-combsum'].time;
        document.getElementById('space-complexity').textContent = PRESETS['preset-combsum'].space;

        // Reset preset complexity fields when user edits the code
        window.editor.onDidChangeModelContent(() => {
            isCustomCode = true;
            document.getElementById('time-complexity').textContent = 'O(?)';
            document.getElementById('space-complexity').textContent = 'O(?)';
        });

        initPyodideApp();
    });

    async function initPyodideApp() {
        const statusEl = document.getElementById('pyodide-status');
        try {
            pyodideInstance = await loadPyodide({
                indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/"
            });

            // Pre-compile tracer runner utility inside Pyodide namespace
            await pyodideInstance.runPythonAsync(PYTHON_TRACER_CODE);

            statusEl.textContent = 'Python Ready';
            statusEl.className = 'pyodide-status-ready';
            runBtn.disabled = false;

            // Initial run with default preset
            runVisualization();
        } catch (err) {
            console.error("Pyodide failed to load:", err);
            statusEl.textContent = 'Load Failed';
            statusEl.className = 'pyodide-status-error';
        }
    }

    // Event Listeners
    runBtn.addEventListener('click', () => {
        runVisualization();
    });

    presetSelect.addEventListener('change', () => {
        const option = presetSelect.value;
        const preset = PRESETS[option];
        if (preset && window.editor) {
            isCustomCode = false;
            window.editor.setValue(preset.code);
            entryCallInput.value = preset.entry;
            document.getElementById('time-complexity').textContent = preset.time;
            document.getElementById('space-complexity').textContent = preset.space;
            runVisualization();
        }
    });

    playBtn.addEventListener('click', () => {
        if (engine.isPlaying) {
            engine.pause();
        } else {
            engine.play();
        }
    });

    prevBtn.addEventListener('click', () => {
        engine.pause();
        engine.prev();
    });

    nextBtn.addEventListener('click', () => {
        engine.pause();
        engine.next();
    });

    resetBtn.addEventListener('click', () => {
        engine.pause();
        engine.jumpTo(0);
    });

    timelineSlider.addEventListener('input', () => {
        engine.pause();
        engine.jumpTo(parseInt(timelineSlider.value));
    });

    speedSlider.addEventListener('input', () => {
        updateEngineSpeed();
    });

    // Zoom Recenter Button
    const zoomResetBtn = document.getElementById('zoom-reset-btn');
    if (zoomResetBtn) {
        zoomResetBtn.addEventListener('click', () => {
            if (currentTree) {
                renderer.resetZoom(currentTree.width, currentTree.height);
            }
        });
    }

    // SVG resize handling
    const svgContainer = document.querySelector('.svg-container');
    if (svgContainer && 'ResizeObserver' in window) {
        const resizeObserver = new ResizeObserver(() => {
            if (currentTree) {
                renderer.resetZoom(currentTree.width, currentTree.height);
            }
        });
        resizeObserver.observe(svgContainer);
    } else {
        window.addEventListener('resize', () => {
            if (currentTree) {
                renderer.resetZoom(currentTree.width, currentTree.height);
            }
        });
    }

    // Footer vertical resize handling
    const resizer = document.getElementById('footer-resize-handle');
    const footer = document.getElementById('code-panel');

    if (resizer && footer) {
        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            document.body.style.cursor = 'row-resize';
            resizer.classList.add('resizing');
            document.body.classList.add('layout-resizing');
            
            const startY = e.clientY;
            const startHeight = footer.offsetHeight;
            
            const onMouseMove = (moveEvent) => {
                const dy = moveEvent.clientY - startY;
                let newHeight = startHeight - dy;
                
                // Limit height between 140px and 450px
                newHeight = Math.max(140, Math.min(450, newHeight));
                footer.style.height = `${newHeight}px`;
            };
            
            const onMouseUp = () => {
                document.body.style.cursor = '';
                resizer.classList.remove('resizing');
                document.body.classList.remove('layout-resizing');
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };
            
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    // Controls Panel Horizontal Resize
    const controlsPanel = document.getElementById('controls-panel');
    const controlsResizer = document.getElementById('controls-resize-handle');
    if (controlsPanel && controlsResizer) {
        controlsResizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            document.body.style.cursor = 'col-resize';
            controlsResizer.classList.add('resizing');
            document.body.classList.add('layout-resizing');
            const startX = e.clientX;
            const startWidth = controlsPanel.offsetWidth;
            
            const onMouseMove = (moveEvent) => {
                const dx = moveEvent.clientX - startX;
                let newWidth = startWidth + dx;
                newWidth = Math.max(260, Math.min(500, newWidth));
                controlsPanel.style.width = `${newWidth}px`;
            };
            
            const onMouseUp = () => {
                document.body.style.cursor = '';
                controlsResizer.classList.remove('resizing');
                document.body.classList.remove('layout-resizing');
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    // Debug Panel Horizontal Resize (adjusts panel width)
    const debugPanel = document.getElementById('debug-panel');
    const debugResizer = document.getElementById('debug-resize-handle');
    
    if (debugPanel && debugResizer) {
        debugResizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            document.body.style.cursor = 'col-resize';
            debugResizer.classList.add('resizing');
            document.body.classList.add('layout-resizing');
            
            const startX = e.clientX;
            const startWidth = debugPanel.offsetWidth;
            
            const onMouseMove = (moveEvent) => {
                const dx = moveEvent.clientX - startX;
                let newWidth = startWidth - dx;
                newWidth = Math.max(260, Math.min(500, newWidth));
                debugPanel.style.width = `${newWidth}px`;
            };
            
            const onMouseUp = () => {
                document.body.style.cursor = '';
                debugResizer.classList.remove('resizing');
                document.body.classList.remove('layout-resizing');
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    // Call Stack Section Height Resize
    const stackSection = document.getElementById('stack-section');
    const stackResizer = document.getElementById('stack-resize-handle');
    if (stackSection && stackResizer) {
        stackResizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            document.body.style.cursor = 'row-resize';
            stackResizer.classList.add('resizing');
            document.body.classList.add('layout-resizing');
            const startY = e.clientY;
            const startHeight = stackSection.offsetHeight;
            
            const onMouseMove = (moveEvent) => {
                const dy = moveEvent.clientY - startY;
                let newHeight = startHeight + dy;
                newHeight = Math.max(80, Math.min(500, newHeight));
                stackSection.style.height = `${newHeight}px`;
                stackSection.style.flex = 'none';
            };
            
            const onMouseUp = () => {
                document.body.style.cursor = '';
                stackResizer.classList.remove('resizing');
                document.body.classList.remove('layout-resizing');
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    // Variables vs Console Height Resize
    const variablesSection = document.getElementById('variables-section');
    const varsResizer = document.getElementById('variables-resize-handle');
    if (variablesSection && varsResizer) {
        varsResizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            document.body.style.cursor = 'row-resize';
            varsResizer.classList.add('resizing');
            document.body.classList.add('layout-resizing');
            const startY = e.clientY;
            const startHeight = variablesSection.offsetHeight;
            
            const onMouseMove = (moveEvent) => {
                const dy = moveEvent.clientY - startY;
                let newHeight = startHeight + dy;
                newHeight = Math.max(100, Math.min(500, newHeight));
                variablesSection.style.height = `${newHeight}px`;
            };
            
            const onMouseUp = () => {
                document.body.style.cursor = '';
                varsResizer.classList.remove('resizing');
                document.body.classList.remove('layout-resizing');
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
        });
    }

    // Premium Card Drag-and-Drop Docking System
    const cards = document.querySelectorAll('.card');
    const slots = document.querySelectorAll('.slot');
    let draggedCard = null;

    cards.forEach(card => {
        card.setAttribute('draggable', 'true');
        
        let isHeaderClick = false;

        card.addEventListener('mousedown', (e) => {
            const handle = card.querySelector('.drag-handle');
            if (handle && handle.contains(e.target) && !e.target.closest('button') && !e.target.closest('select') && !e.target.closest('input')) {
                isHeaderClick = true;
            } else {
                isHeaderClick = false;
            }
        });

        card.addEventListener('dragstart', (e) => {
            if (!isHeaderClick) {
                e.preventDefault();
                return;
            }
            draggedCard = card;
            card.classList.add('dragging');
            e.dataTransfer.setData('text/plain', card.id);
            e.dataTransfer.effectAllowed = 'move';
            
            document.body.classList.add('dragging-active');
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            document.body.classList.remove('dragging-active');
            draggedCard = null;
            isHeaderClick = false;
            slots.forEach(s => s.classList.remove('drag-over'));
        });
    });

    slots.forEach(slot => {
        let dragEnterCounter = 0;

        slot.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        slot.addEventListener('dragenter', (e) => {
            e.preventDefault();
            dragEnterCounter++;
            if (draggedCard && !slot.contains(draggedCard)) {
                slot.classList.add('drag-over');
            }
        });

        slot.addEventListener('dragleave', () => {
            dragEnterCounter--;
            if (dragEnterCounter <= 0) {
                dragEnterCounter = 0;
                slot.classList.remove('drag-over');
            }
        });

        slot.addEventListener('drop', (e) => {
            e.preventDefault();
            dragEnterCounter = 0;
            slot.classList.remove('drag-over');
            
            const cardId = e.dataTransfer.getData('text/plain');
            const sourceCard = document.getElementById(cardId);
            
            if (sourceCard && !slot.contains(sourceCard)) {
                const targetCard = slot.querySelector('.card');
                if (targetCard) {
                    const sourceParentSlot = sourceCard.parentNode;
                    
                    // Swap the elements in the DOM! Keep card as firstChild in slot wrappers
                    sourceParentSlot.insertBefore(targetCard, sourceParentSlot.firstChild);
                    slot.insertBefore(sourceCard, slot.firstChild);
                    
                    // Trigger Monaco Layout recalculation if editor was moved
                    if (window.editor) {
                        setTimeout(() => {
                            window.editor.layout();
                        }, 50);
                    }
                    
                    // Trigger SVG zoom recalculation
                    window.dispatchEvent(new Event('resize'));
                }
            }
        });
    });
});
