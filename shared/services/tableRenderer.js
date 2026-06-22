/**
 * Table Renderer Service
 * Handles all table rendering and row creation logic
 * @module services/TableRenderer
 */

const TableRenderer = {
    /**
     * Render a complete table with header and body
     * @param {Object} options - Table rendering options
     * @param {HTMLElement} options.container - Container element to render table into
     * @param {Array} options.columns - Column definitions
     * @param {Array} options.data - Data rows
     * @param {Object} options.config - Table configuration
     * @returns {HTMLTableElement} Created table element
     */
    renderTable({ container, columns, data = [], config = {} }) {
        if (!container) {
            throw new Error('Container element is required');
        }

        const table = document.createElement('table');
        table.className = config.className || 'data-table';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        
        columns.forEach(column => {
            const th = document.createElement('th');
            th.textContent = column.header || column.label || '';
            if (column.className) th.className = column.className;
            if (column.width) th.style.width = column.width;
            headerRow.appendChild(th);
        });

        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement('tbody');
        if (config.tbodyId) tbody.id = config.tbodyId;

        if (data.length === 0 && config.emptyMessage) {
            const emptyRow = document.createElement('tr');
            const emptyCell = document.createElement('td');
            emptyCell.colSpan = columns.length;
            emptyCell.textContent = config.emptyMessage;
            emptyCell.className = 'empty-message';
            emptyCell.style.textAlign = 'center';
            emptyRow.appendChild(emptyCell);
            tbody.appendChild(emptyRow);
        } else {
            data.forEach((rowData, index) => {
                const row = this.renderRow({ columns, rowData, rowIndex: index, config });
                tbody.appendChild(row);
            });
        }

        table.appendChild(tbody);

        if (config.showTotal && config.totalRowData) {
            const tfoot = document.createElement('tfoot');
            const totalRow = this.renderTotalRow({ columns, totalData: config.totalRowData, config });
            tfoot.appendChild(totalRow);
            table.appendChild(tfoot);
        }

        if (container.tagName === 'TBODY') {
            container.parentNode.replaceChild(tbody, container);
            return container.parentNode;
        } else {
            container.innerHTML = '';
            container.appendChild(table);
            return table;
        }
    },

    /**
     * Render a single table row
     * @param {Object} options - Row rendering options
     * @param {Array} options.columns - Column definitions
     * @param {Object} options.rowData - Row data object
     * @param {number} options.rowIndex - Row index
     * @param {Object} options.config - Row configuration
     * @returns {HTMLTableRowElement} Created row element
     */
    renderRow({ columns, rowData, rowIndex = 0, config = {} }) {
        const row = document.createElement('tr');
        if (config.rowClassName) {
            row.className = config.rowClassName;
        }
        if (config.rowId) {
            row.id = typeof config.rowId === 'function' ? config.rowId(rowData, rowIndex) : config.rowId;
        }

        columns.forEach((column, colIndex) => {
            const cell = document.createElement('td');
            
            if (column.render && typeof column.render === 'function') {
                const renderedContent = column.render(rowData, rowIndex, colIndex);
                if (renderedContent instanceof HTMLElement) {
                    cell.appendChild(renderedContent);
                } else {
                    cell.innerHTML = renderedContent;
                }
            } else if (column.field) {
                const value = this.getNestedValue(rowData, column.field);
                if (column.type === 'currency') {
                    cell.textContent = window.Formatters ? window.Formatters.formatCurrency(value || 0) : `£${(value || 0).toFixed(2)}`;
                } else if (column.type === 'date') {
                    cell.textContent = window.Formatters ? window.Formatters.formatDate(value) : value || '';
                } else if (column.type === 'boolean') {
                    cell.textContent = value ? '✓' : '';
                } else {
                    cell.textContent = value || '';
                }
            }

            if (column.cellClassName) {
                cell.className = column.cellClassName;
            }

            row.appendChild(cell);
        });

        return row;
    },

    /**
     * Render a total row
     * @param {Object} options - Total row options
     * @param {Array} options.columns - Column definitions
     * @param {Object} options.totalData - Total data object
     * @param {Object} options.config - Configuration
     * @returns {HTMLTableRowElement} Created total row
     */
    renderTotalRow({ columns, totalData = {}, config = {} }) {
        const row = document.createElement('tr');
        row.className = 'total-row';

        columns.forEach((column, index) => {
            const cell = document.createElement('td');
            
            if (index === 0) {
                cell.innerHTML = '<strong>TOTALS</strong>';
            } else if (column.totalField) {
                const value = this.getNestedValue(totalData, column.totalField);
                if (column.type === 'currency') {
                    cell.innerHTML = `<strong>${window.Formatters ? window.Formatters.formatCurrency(value || 0) : `£${(value || 0).toFixed(2)}`}</strong>`;
                } else {
                    cell.innerHTML = `<strong>${value || ''}</strong>`;
                }
            } else if (column.totalId) {
                cell.id = column.totalId;
            }

            row.appendChild(cell);
        });

        return row;
    },

    /**
     * Update table with new data
     * @param {HTMLElement} tbody - Table body element
     * @param {Array} data - New data array
     * @param {Array} columns - Column definitions
     * @param {Object} config - Configuration
     */
    updateTable(tbody, data, columns, config = {}) {
        if (!tbody) {
            throw new Error('Table body element is required');
        }

        tbody.innerHTML = '';

        if (data.length === 0 && config.emptyMessage) {
            const emptyRow = document.createElement('tr');
            const emptyCell = document.createElement('td');
            emptyCell.colSpan = columns.length;
            emptyCell.textContent = config.emptyMessage;
            emptyCell.className = 'empty-message';
            emptyCell.style.textAlign = 'center';
            emptyRow.appendChild(emptyCell);
            tbody.appendChild(emptyRow);
        } else {
            data.forEach((rowData, index) => {
                const row = this.renderRow({ columns, rowData, rowIndex: index, config });
                tbody.appendChild(row);
            });
        }
    },

    /**
     * Create an editable input cell
     * @param {Object} options - Input cell options
     * @param {string} options.type - Input type
     * @param {*} options.value - Initial value
     * @param {string} options.className - CSS class
     * @param {Function} options.onChange - Change handler
     * @param {Object} options.attributes - Additional attributes
     * @returns {HTMLElement} Input element
     */
    createInputCell({ type = 'text', value = '', className = '', onChange = null, attributes = {} }) {
        if (window.FormHandler) {
            return window.FormHandler.createInput({ type, value, className, onChange, attributes });
        }
        
        const input = document.createElement('input');
        input.type = type;
        input.value = value || '';
        if (className) input.className = className;
        Object.entries(attributes).forEach(([key, val]) => {
            input.setAttribute(key, val);
        });
        if (onChange) input.addEventListener('input', onChange);
        return input;
    },

    /**
     * Create an editable textarea cell
     * @param {Object} options - Textarea cell options
     * @param {string} options.value - Initial value
     * @param {string} options.className - CSS class
     * @param {Function} options.onChange - Change handler
     * @param {Object} options.attributes - Additional attributes
     * @returns {HTMLElement} Textarea element
     */
    createTextareaCell({ value = '', className = '', onChange = null, attributes = {} }) {
        if (window.FormHandler) {
            return window.FormHandler.createTextarea({ value, className, onChange, attributes });
        }
        
        const textarea = document.createElement('textarea');
        textarea.value = value || '';
        if (className) textarea.className = className;
        Object.entries(attributes).forEach(([key, val]) => {
            textarea.setAttribute(key, val);
        });
        if (onChange) textarea.addEventListener('input', onChange);
        return textarea;
    },

    /**
     * Create a select cell
     * @param {Object} options - Select cell options
     * @param {Array} options.options - Option array
     * @param {string} options.value - Selected value
     * @param {string} options.className - CSS class
     * @param {Function} options.onChange - Change handler
     * @returns {HTMLElement} Select element
     */
    createSelectCell({ options = [], value = '', className = '', onChange = null }) {
        if (window.FormHandler) {
            return window.FormHandler.createSelect({ options, value, className, onChange });
        }
        
        const select = document.createElement('select');
        if (className) select.className = className;
        options.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option.value || '';
            optionElement.textContent = option.text || option.label || '';
            if (option.value === value) optionElement.selected = true;
            select.appendChild(optionElement);
        });
        if (onChange) select.addEventListener('change', onChange);
        return select;
    },

    /**
     * Get nested value from object using dot notation
     * @param {Object} obj - Source object
     * @param {string} path - Dot notation path
     * @returns {*} Value at path
     */
    getNestedValue(obj, path) {
        if (!obj || !path) return null;
        return path.split('.').reduce((current, prop) => current?.[prop], obj);
    },

    /**
     * Create delete button cell
     * @param {Function} onDelete - Delete handler
     * @param {string} ariaLabel - ARIA label
     * @returns {HTMLElement} Delete button
     */
    createDeleteButton(onDelete, ariaLabel = 'Delete row') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'delete-row-x';
        button.textContent = '×';
        button.setAttribute('aria-label', ariaLabel);
        if (onDelete) {
            button.addEventListener('click', onDelete);
        }
        return button;
    }
};

if (typeof window !== 'undefined') {
    window.TableRenderer = TableRenderer;
}
