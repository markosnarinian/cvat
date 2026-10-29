// Copyright (C) 2020-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

/// <reference types="cypress" />

import { taskName, labelName } from '../../support/const';

context('Actions on rectangle', () => {
    const caseId = '8';
    const newLabelName = `New label for case ${caseId}`;
    const createRectangleShape2Points = {
        points: 'By 2 Points',
        type: 'Shape',
        labelName,
        firstX: 250,
        firstY: 350,
        secondX: 350,
        secondY: 450,
    };
    const createRectangleShape4Points = {
        points: 'By 4 Points',
        type: 'Shape',
        labelName,
        firstX: 400,
        firstY: 350,
        secondX: 500,
        secondY: 350,
        thirdX: 500,
        thirdY: 450,
        fourthX: 400,
        fourthY: 450,
    };
    const createRectangleTrack2Points = {
        points: 'By 2 Points',
        type: 'Track',
        labelName,
        firstX: createRectangleShape2Points.firstX,
        firstY: createRectangleShape2Points.firstY - 150,
        secondX: createRectangleShape2Points.secondX,
        secondY: createRectangleShape2Points.secondY - 150,
    };
    const createRectangleTrack4Points = {
        points: 'By 4 Points',
        type: 'Track',
        labelName,
        firstX: createRectangleShape4Points.firstX,
        firstY: createRectangleShape4Points.firstY - 150,
        secondX: createRectangleShape4Points.secondX - 100,
        secondY: createRectangleShape4Points.secondY - 50,
        thirdX: createRectangleShape4Points.thirdX,
        thirdY: createRectangleShape4Points.thirdY - 150,
        fourthX: createRectangleShape4Points.fourthX,
        fourthY: createRectangleShape4Points.fourthY - 150,
    };
    const createRectangleShape2PointsNewLabel = {
        labelName: newLabelName,
        points: 'By 2 Points',
        type: 'Shape',
        firstX: createRectangleShape2Points.firstX,
        firstY: createRectangleShape2Points.firstY + 150,
        secondX: createRectangleShape2Points.secondX,
        secondY: createRectangleShape2Points.secondY + 150,
    };
    const createRectangleShape4PointsNewLabel = {
        labelName: newLabelName,
        points: 'By 4 Points',
        type: 'Shape',
        firstX: createRectangleShape4Points.firstX,
        firstY: createRectangleShape4Points.firstY + 150,
        secondX: createRectangleShape4Points.secondX,
        secondY: createRectangleShape4Points.secondY + 150,
        thirdX: createRectangleShape4Points.thirdX,
        thirdY: createRectangleShape4Points.thirdY + 150,
        fourthX: createRectangleShape4Points.fourthX,
        fourthY: createRectangleShape4Points.fourthY + 150,
    };

    before(() => {
        cy.prepareUserSession();
        cy.openTask(taskName);
        cy.addNewLabel({ name: newLabelName });
        cy.openJob();
    });

    describe(`Testing case "${caseId}"`, () => {
        it('Draw a rectangle shape in two ways (by 2 points, by 4 points)', () => {
            cy.createRectangle(createRectangleShape2Points);
            cy.createRectangle(createRectangleShape4Points);
        });

        it('Draw a rectangle track in two ways (by 2 points, by 4 points)', () => {
            cy.createRectangle(createRectangleTrack2Points);
            cy.createRectangle(createRectangleTrack4Points);
        });

        it('Draw a new rectangle shape in two ways (by 2 points, by 4 points) with second label', () => {
            cy.createRectangle(createRectangleShape2PointsNewLabel);
            cy.createRectangle(createRectangleShape4PointsNewLabel);
        });

        it('The second shape is activated if the first one was removed during the move (fix 4151).', () => {
            let xCoordinate;
            cy.get('#cvat_canvas_shape_6').trigger('mousemove');
            cy.get('#cvat_canvas_shape_6').trigger('mouseover');
            cy.get('#cvat_canvas_shape_6').should('have.class', 'cvat_canvas_shape_activated');
            cy.get('#cvat_canvas_shape_6').trigger('mousedown', { which: 1 });
            cy.get('#cvat_canvas_shape_6').then((shape) => {
                xCoordinate = shape.attr('x');
            });
            cy.get('.cvat_canvas_text').should('have.class', 'cvat_canvas_hidden');
            cy.get('.cvat-canvas-container').trigger('mousemove', 550, 550);
            cy.get('#cvat_canvas_shape_6').then((shape) => {
                expect(Number(xCoordinate)).lt(Number(shape.attr('x')));
            });
            cy.get('body').type('{del}');
            cy.get('#cvat_canvas_shape_6').should('not.exist');
            cy.get('#cvat_canvas_shape_5').trigger('mousemove');
            cy.get('#cvat_canvas_shape_5').trigger('mouseover');
            cy.get('#cvat_canvas_shape_5').should('have.class', 'cvat_canvas_shape_activated');
        });

        for (const part of ['corner', 'body']) {
            it(`Pick up a rectangle ${part} with a click, cancel, then click to place it`, () => {
                cy.createRectangle(createRectangleShape2Points);
                cy.get('rect.cvat_canvas_shape').last().as('rectangle');
                cy.get('@rectangle').trigger('mousemove');
                cy.get('@rectangle').trigger('mouseover');
                cy.get('@rectangle').should('have.class', 'cvat_canvas_shape_activated');

                cy.get('@rectangle').then(([rectangle]) => {
                    const original = rectangle.getBoundingClientRect();
                    const corner = part === 'corner';
                    const target = {
                        clientX: original.left + (corner ? 0 : original.width / 2) - 43,
                        clientY: original.top + (corner ? 0 : original.height / 2) - 27,
                    };
                    const pickup = corner ? '.svg_select_points_lt' : '@rectangle';

                    cy.get(pickup).click();
                    cy.get('.cvat-canvas-container').trigger('mousemove', { ...target, buttons: 0 });
                    cy.get('@rectangle').should(([shape]) => {
                        const preview = shape.getBoundingClientRect();
                        expect(preview.left).to.be.closeTo(original.left - 43, 2);
                        expect(preview.top).to.be.closeTo(original.top - 27, 2);
                        expect(preview.width).to.be.closeTo(original.width + (corner ? 43 : 0), 2);
                        expect(preview.height).to.be.closeTo(original.height + (corner ? 27 : 0), 2);
                    });
                    cy.get('body').type('{esc}');
                    cy.get('@rectangle').should(([shape]) => {
                        expect(shape.getBoundingClientRect().left).to.be.closeTo(original.left, 1);
                        expect(shape.getBoundingClientRect().top).to.be.closeTo(original.top, 1);
                        expect(shape.getBoundingClientRect().width).to.be.closeTo(original.width, 1);
                        expect(shape.getBoundingClientRect().height).to.be.closeTo(original.height, 1);
                    });

                    cy.get('@rectangle').trigger('mousemove');
                    cy.get('@rectangle').trigger('mouseover');
                    cy.get(pickup).click();
                    cy.get('.cvat-canvas-container').trigger('mousemove', { ...target, buttons: 0 });
                    cy.get('.cvat-canvas-container').trigger('mousedown', { ...target, button: 0 });
                    cy.get('.cvat-canvas-container').trigger('mouseup', { ...target, button: 0 });
                    cy.get('.cvat-canvas-container').trigger('mousemove', {
                        clientX: original.left - 91, clientY: original.top - 68, buttons: 0,
                    });
                    cy.get('@rectangle').should(([shape]) => {
                        const placed = shape.getBoundingClientRect();
                        expect(placed.left).to.be.closeTo(original.left - 43, 2);
                        expect(placed.top).to.be.closeTo(original.top - 27, 2);
                        expect(placed.width).to.be.closeTo(original.width + (corner ? 43 : 0), 2);
                        expect(placed.height).to.be.closeTo(original.height + (corner ? 27 : 0), 2);
                    });
                    cy.get('body').type('{ctrl}z');
                    cy.get('@rectangle').should(([shape]) => {
                        expect(shape.getBoundingClientRect().left).to.be.closeTo(original.left, 1);
                        expect(shape.getBoundingClientRect().top).to.be.closeTo(original.top, 1);
                        expect(shape.getBoundingClientRect().width).to.be.closeTo(original.width, 1);
                        expect(shape.getBoundingClientRect().height).to.be.closeTo(original.height, 1);
                    });
                });
            });
        }
    });
});
