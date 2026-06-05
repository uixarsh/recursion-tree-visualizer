export class StackPanel {
    constructor(elementId) {
        this.container = document.getElementById(elementId);
    }

    render(stack) {
        this.container.innerHTML = '';
        if (!stack || stack.length === 0) {
            this.container.innerHTML = '<div class="empty-state">Call stack is empty</div>';
            return;
        }

        // Render stack from top to bottom (reverse order of array)
        for (let i = stack.length - 1; i >= 0; i--) {
            const card = document.createElement('div');
            card.className = `stack-card ${i === stack.length - 1 ? 'stack-card-top' : ''}`;
            
            const title = document.createElement('div');
            title.className = 'stack-card-title';
            title.textContent = stack[i]; // Just show the call label directly! E.g. "fib(n=4)"
            
            if (i === stack.length - 1) {
                const badge = document.createElement('span');
                badge.className = 'stack-badge';
                badge.textContent = 'ACTIVE';
                title.appendChild(badge);
            }
            
            const content = document.createElement('div');
            content.className = 'stack-card-content';
            content.textContent = `Frame #${i + 1}`;

            card.appendChild(title);
            card.appendChild(content);
            this.container.appendChild(card);
        }
    }
}
