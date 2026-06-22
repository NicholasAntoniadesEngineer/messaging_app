/**
 * Form Handler Service
 * Handles form input creation, validation, and data extraction
 * @module services/FormHandler
 */

const FormHandler = {
    /**
     * Create a text input element
     * @param {Object} options - Input options
     * @param {string} options.type - Input type (text, number, date, etc.)
     * @param {string} options.value - Initial value
     * @param {string} options.placeholder - Placeholder text
     * @param {string} options.className - CSS class name
     * @param {string} options.id - Element ID
     * @param {Function} options.onChange - Change event handler
     * @param {Object} options.attributes - Additional attributes
     * @returns {HTMLInputElement} Created input element
     */
    createInput({ type = 'text', value = '', placeholder = '', className = '', id = '', onChange = null, attributes = {} }) {
        const input = document.createElement('input');
        input.type = type;
        input.value = value || '';
        input.placeholder = placeholder;
        if (className) input.className = className;
        if (id) input.id = id;
        
        Object.entries(attributes).forEach(([key, val]) => {
            input.setAttribute(key, val);
        });

        if (onChange && typeof onChange === 'function') {
            input.addEventListener('input', onChange);
        }

        return input;
    },

    /**
     * Create a textarea element
     * @param {Object} options - Textarea options
     * @param {string} options.value - Initial value
     * @param {string} options.placeholder - Placeholder text
     * @param {string} options.className - CSS class name
     * @param {string} options.id - Element ID
     * @param {Function} options.onChange - Change event handler
     * @param {Object} options.attributes - Additional attributes
     * @returns {HTMLTextAreaElement} Created textarea element
     */
    createTextarea({ value = '', placeholder = '', className = '', id = '', onChange = null, attributes = {} }) {
        const textarea = document.createElement('textarea');
        textarea.value = value || '';
        textarea.placeholder = placeholder;
        if (className) textarea.className = className;
        if (id) textarea.id = id;
        
        Object.entries(attributes).forEach(([key, val]) => {
            textarea.setAttribute(key, val);
        });

        if (onChange && typeof onChange === 'function') {
            textarea.addEventListener('input', onChange);
        }

        return textarea;
    },

    /**
     * Create a select element with options
     * @param {Object} options - Select options
     * @param {Array} options.options - Array of {value, text} objects
     * @param {string} options.value - Selected value
     * @param {string} options.className - CSS class name
     * @param {string} options.id - Element ID
     * @param {Function} options.onChange - Change event handler
     * @param {Object} options.attributes - Additional attributes
     * @returns {HTMLSelectElement} Created select element
     */
    createSelect({ options = [], value = '', className = '', id = '', onChange = null, attributes = {} }) {
        const select = document.createElement('select');
        if (className) select.className = className;
        if (id) select.id = id;
        
        Object.entries(attributes).forEach(([key, val]) => {
            select.setAttribute(key, val);
        });

        options.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option.value || '';
            optionElement.textContent = option.text || option.label || '';
            if (option.value === value) {
                optionElement.selected = true;
            }
            select.appendChild(optionElement);
        });

        if (onChange && typeof onChange === 'function') {
            select.addEventListener('change', onChange);
        }

        return select;
    },

    /**
     * Create a date input element
     * @param {Object} options - Date input options
     * @param {string} options.value - Initial date value (YYYY-MM-DD)
     * @param {string} options.className - CSS class name
     * @param {string} options.id - Element ID
     * @param {Function} options.onChange - Change event handler
     * @param {Object} options.attributes - Additional attributes
     * @returns {HTMLInputElement} Created date input element
     */
    createDateInput({ value = '', className = '', id = '', onChange = null, attributes = {} }) {
        return this.createInput({
            type: 'date',
            value,
            className,
            id,
            onChange,
            attributes
        });
    },

    /**
     * Create a checkbox input element
     * @param {Object} options - Checkbox options
     * @param {boolean} options.checked - Initial checked state
     * @param {string} options.className - CSS class name
     * @param {string} options.id - Element ID
     * @param {Function} options.onChange - Change event handler
     * @param {Object} options.attributes - Additional attributes
     * @returns {HTMLInputElement} Created checkbox element
     */
    createCheckbox({ checked = false, className = '', id = '', onChange = null, attributes = {} }) {
        const checkbox = this.createInput({
            type: 'checkbox',
            className,
            id,
            onChange,
            attributes
        });
        checkbox.checked = checked;
        return checkbox;
    },

    /**
     * Get form data from a form element or container
     * @param {HTMLElement} formElement - Form or container element
     * @param {Object} fieldMappings - Optional field name mappings
     * @returns {Object} Form data object
     */
    getFormData(formElement, fieldMappings = {}) {
        if (!formElement) {
            throw new Error('Form element is required');
        }

        const formData = {};
        const inputs = formElement.querySelectorAll('input, select, textarea');

        inputs.forEach(input => {
            const fieldName = fieldMappings[input.name] || input.name || input.id;
            if (!fieldName) return;

            if (input.type === 'checkbox') {
                formData[fieldName] = input.checked;
            } else if (input.type === 'number') {
                formData[fieldName] = parseFloat(input.value) || 0;
            } else {
                formData[fieldName] = input.value || '';
            }
        });

        return formData;
    },

    /**
     * Validate form fields
     * @param {HTMLElement} formElement - Form element to validate
     * @param {Object} validationRules - Validation rules object
     * @returns {Object} Validation result with isValid and errors
     */
    validateForm(formElement, validationRules = {}) {
        if (!formElement) {
            return { isValid: false, errors: ['Form element is required'] };
        }

        const errors = [];
        const inputs = formElement.querySelectorAll('input, select, textarea');

        inputs.forEach(input => {
            const fieldName = input.name || input.id;
            if (!fieldName) return;

            const rules = validationRules[fieldName];
            if (!rules) return;

            const value = input.type === 'checkbox' ? input.checked : input.value;

            if (rules.required && !value) {
                errors.push(`${fieldName} is required`);
            }

            if (rules.min && parseFloat(value) < rules.min) {
                errors.push(`${fieldName} must be at least ${rules.min}`);
            }

            if (rules.max && parseFloat(value) > rules.max) {
                errors.push(`${fieldName} must be at most ${rules.max}`);
            }

            if (rules.pattern && !rules.pattern.test(value)) {
                errors.push(`${fieldName} format is invalid`);
            }
        });

        return {
            isValid: errors.length === 0,
            errors
        };
    },

    /**
     * Set form values from data object
     * @param {HTMLElement} formElement - Form element
     * @param {Object} data - Data object with field names as keys
     */
    setFormData(formElement, data) {
        if (!formElement || !data) {
            return;
        }

        Object.entries(data).forEach(([key, value]) => {
            const input = formElement.querySelector(`[name="${key}"], #${key}`);
            if (!input) return;

            if (input.type === 'checkbox') {
                input.checked = Boolean(value);
            } else {
                input.value = value || '';
            }
        });
    }
};

if (typeof window !== 'undefined') {
    window.FormHandler = FormHandler;
}
