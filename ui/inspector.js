export class Inspector {
    constructor(variablesElementId, resultsElementId) {
        this.varsContainer = document.getElementById(variablesElementId);
        this.resultsContainer = document.getElementById(resultsElementId);
        
        this.activeTab = 'console'; // default active tab
        this.consoleData = { stdout: '', exception: null, returnValue: null, stepCount: 0 };
        this.solutionsData = [];
        
        this.setupTabs();
    }

    setupTabs() {
        const consoleBtn = document.getElementById('tab-console');
        const solutionsBtn = document.getElementById('tab-solutions');
        
        if (consoleBtn && solutionsBtn) {
            consoleBtn.addEventListener('click', () => {
                this.activeTab = 'console';
                consoleBtn.classList.add('active');
                solutionsBtn.classList.remove('active');
                this.updateResultsView();
            });
            
            solutionsBtn.addEventListener('click', () => {
                this.activeTab = 'solutions';
                solutionsBtn.classList.add('active');
                consoleBtn.classList.remove('active');
                this.updateResultsView();
            });
        }
    }

    renderVariables(inspectorData) {
        this.varsContainer.innerHTML = '';
        if (!inspectorData || (!inspectorData.locals && !inspectorData.globals)) {
            this.varsContainer.innerHTML = '<div class="empty-state">No variables to inspect</div>';
            return;
        }

        const createSection = (titleText, vars) => {
            const title = document.createElement('div');
            title.className = 'variables-section-title';
            title.textContent = titleText;
            this.varsContainer.appendChild(title);

            if (!vars || Object.keys(vars).length === 0) {
                const empty = document.createElement('div');
                empty.className = 'empty-state';
                empty.textContent = 'None';
                this.varsContainer.appendChild(empty);
                return;
            }

            const table = document.createElement('table');
            table.className = 'inspector-table';

            for (const [name, val] of Object.entries(vars)) {
                const row = document.createElement('tr');
                let valueHtml = '';
                
                // Style variable formatting based on type
                if (typeof val === 'number') {
                    valueHtml = `<span class="badge badge-info">${val}</span>`;
                } else if (typeof val === 'boolean') {
                    valueHtml = `<span class="badge ${val ? 'badge-success' : 'badge-danger'}">${val}</span>`;
                } else if (val === null) {
                    valueHtml = `<span class="text-muted">None</span>`;
                } else if (Array.isArray(val)) {
                    valueHtml = `<span class="var-list">[${val.join(', ')}]</span>`;
                } else if (typeof val === 'object') {
                    valueHtml = `<span class="var-other">${JSON.stringify(val)}</span>`;
                } else {
                    valueHtml = `<span class="var-other">${String(val)}</span>`;
                }

                row.innerHTML = `
                    <td class="var-name">${name}</td>
                    <td class="var-value">${valueHtml}</td>
                `;
                table.appendChild(row);
            }
            this.varsContainer.appendChild(table);
        };

        createSection('Local Scope', inspectorData.locals || {});
        createSection('Global Scope', inspectorData.globals || {});
    }

    setConsoleData(stdout, exception, returnValue, stepCount) {
        this.consoleData = { stdout, exception, returnValue, stepCount };
        this.updateResultsView();
    }

    setSolutionsData(solutions) {
        this.solutionsData = solutions;
        this.updateResultsView();
    }

    updateResultsView() {
        this.resultsContainer.innerHTML = '';
        
        if (this.activeTab === 'console') {
            const consoleDiv = document.createElement('div');
            consoleDiv.className = 'console-view';
            
            if (this.consoleData.exception) {
                const errDiv = document.createElement('div');
                errDiv.className = 'console-error';
                errDiv.textContent = this.consoleData.exception;
                consoleDiv.appendChild(errDiv);
            }
            
            if (this.consoleData.stdout) {
                const outDiv = document.createElement('div');
                outDiv.className = 'console-stdout';
                outDiv.textContent = this.consoleData.stdout;
                consoleDiv.appendChild(outDiv);
            } else if (!this.consoleData.exception) {
                const empty = document.createElement('div');
                empty.className = 'empty-state';
                empty.textContent = 'No console output. Use print() in your code to log values.';
                consoleDiv.appendChild(empty);
            }
            
            // Console stats summary
            const statsDiv = document.createElement('div');
            statsDiv.className = 'console-stats';
            statsDiv.innerHTML = `
                <div>Trace Steps: <span class="badge badge-info">${this.consoleData.stepCount}</span></div>
                <div>Returned: <span class="badge badge-accent">${this.consoleData.returnValue !== null && this.consoleData.returnValue !== undefined ? this.consoleData.returnValue : 'None'}</span></div>
            `;
            consoleDiv.appendChild(statsDiv);
            
            this.resultsContainer.appendChild(consoleDiv);
        } else {
            // Render Solutions
            if (!this.solutionsData || this.solutionsData.length === 0) {
                this.resultsContainer.innerHTML = '<div class="empty-state">No solutions found. Return True from success branches to list them.</div>';
                return;
            }
            
            const title = document.createElement('h3');
            title.className = 'results-title';
            title.textContent = `Successful Paths (${this.solutionsData.length})`;
            this.resultsContainer.appendChild(title);

            const list = document.createElement('div');
            list.className = 'results-list';
            
            this.solutionsData.forEach((res, index) => {
                const card = document.createElement('div');
                card.className = 'result-card fade-in';
                card.innerHTML = `
                    <span class="result-number">#${index + 1}</span>
                    <span class="result-value">${res}</span>
                `;
                list.appendChild(card);
            });
            
            this.resultsContainer.appendChild(list);
        }
    }
}
