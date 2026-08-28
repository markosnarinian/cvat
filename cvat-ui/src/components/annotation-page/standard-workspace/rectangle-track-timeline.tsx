// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import './rectangle-track-timeline.scss';

import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    CaretDownOutlined, CaretUpOutlined, LeftOutlined, RightOutlined,
} from '@ant-design/icons';
import Button from 'antd/lib/button';
import Select from 'antd/lib/select';

import { FramesMetaData, getCore, RectangleTrackMetadata } from 'cvat-core-wrapper';
import { CombinedState } from 'reducers';
import {
    navigateAnnotationFrameAsync, navigateToRectangleTrackAsync,
} from 'actions/annotation-actions';
import { registerComponentShortcuts } from 'actions/shortcuts-actions';
import GlobalHotKeys from 'utils/mousetrap-react';
import { subKeyMap } from 'utils/component-subkeymap';
import { ShortcutScope } from 'utils/enums';

const componentShortcuts = {
    PREVIOUS_ANNOTATION_FRAME: {
        name: 'Previous annotation frame',
        description: 'Go to the previous frame containing an annotation in the timeline label scope',
        sequences: ['['],
        scope: ShortcutScope.ANNOTATION_PAGE,
    },
    NEXT_ANNOTATION_FRAME: {
        name: 'Next annotation frame',
        description: 'Go to the next frame containing an annotation in the timeline label scope',
        sequences: [']'],
        scope: ShortcutScope.ANNOTATION_PAGE,
    },
    PREVIOUS_RECTANGLE_TRACK: {
        name: 'Previous rectangle track',
        description: 'Activate the previous rectangle track in the timeline label scope',
        sequences: ['shift+['],
        scope: ShortcutScope.ANNOTATION_PAGE,
    },
    NEXT_RECTANGLE_TRACK: {
        name: 'Next rectangle track',
        description: 'Activate the next rectangle track in the timeline label scope',
        sequences: ['shift+]'],
        scope: ShortcutScope.ANNOTATION_PAGE,
    },
};

registerComponentShortcuts(componentShortcuts);

function pathForKeyframes(
    keyframes: RectangleTrackMetadata['keyframes'],
    frameIndexes: Map<number, number>,
    frameCount: number,
): string {
    return keyframes.map(({ frame }) => {
        const x = ((frameIndexes.get(frame) ?? 0) / Math.max(1, frameCount - 1)) * 1000;
        return `M ${x} 0 V 24`;
    }).join(' ');
}

export default function RectangleTrackTimeline(): JSX.Element {
    const dispatch = useDispatch<any>();
    const {
        activeID, frame, frameNumbers, jobInstance, keyMap, metadataRevision,
    } = useSelector((state: CombinedState) => ({
        activeID: state.annotation.annotations.activatedStateID,
        frame: state.annotation.player.frame.number,
        frameNumbers: state.annotation.job.frameNumbers,
        jobInstance: state.annotation.job.instance,
        keyMap: state.shortcuts.keyMap,
        metadataRevision: state.annotation.rectangleTrack.metadataRevision,
    }));
    const [expanded, setExpanded] = useState(false);
    const [labelID, setLabelID] = useState<number | null>(null);
    const [tracks, setTracks] = useState<RectangleTrackMetadata[]>([]);
    const [deletedFrames, setDeletedFrames] = useState<FramesMetaData['deletedFrames'] | null>(null);

    useEffect(() => {
        let active = true;
        if (!jobInstance) return () => { active = false; };
        jobInstance.annotations.rectangleTrackMetadata()
            .then((metadata) => {
                if (active) setTracks(metadata);
            })
            .catch(() => {
                if (active) setTracks([]);
            });
        return () => { active = false; };
    }, [jobInstance, metadataRevision]);

    useEffect(() => {
        let active = true;
        if (!jobInstance) return () => { active = false; };
        getCore().frames.getMeta('job', jobInstance.id)
            .then((metadata) => {
                if (active) setDeletedFrames(metadata.deletedFrames);
            })
            .catch(() => {
                if (active) setDeletedFrames(null);
            });
        return () => { active = false; };
    }, [frame, jobInstance, metadataRevision]);

    const filteredTracks = useMemo(() => tracks.filter((track) => (
        labelID === null || track.labelID === labelID
    )), [labelID, tracks]);
    const frameIndexes = useMemo(() => new Map(frameNumbers.map((number, index) => (
        [number, index]
    ))), [frameNumbers]);
    const navigableFrameNumbers = deletedFrames ?
        frameNumbers.filter((candidate) => !deletedFrames[candidate]) : [];
    const currentPosition = ((frameIndexes.get(frame) ?? 0) / Math.max(1, frameNumbers.length - 1)) * 100;
    const labelOptions = useMemo(() => [
        { value: 'any', label: 'Any label' },
        ...jobInstance.labels.map((label) => ({ value: `${label.id}`, label: label.name })),
    ], [jobInstance]);

    const navigateAnnotation = (direction: 'forward' | 'backward'): void => {
        dispatch(navigateAnnotationFrameAsync(direction, labelID));
    };

    const segmentFrames = (segment: RectangleTrackMetadata['visibleSegments'][0]): number[] => (
        navigableFrameNumbers.filter((candidate) => candidate >= segment.start && candidate <= segment.stop)
    );

    const visibleTrackFrames = (track: RectangleTrackMetadata): number[] => (
        track.visibleSegments.flatMap(segmentFrames)
    );

    const nearestFrame = (candidates: number[], preferredFrame: number): number | null => {
        if (!candidates.length) return null;
        const preferredIndex = frameIndexes.get(preferredFrame);
        if (typeof preferredIndex === 'undefined') return candidates[0];

        return candidates.reduce((nearest, candidate) => {
            const candidateDistance = Math.abs((frameIndexes.get(candidate) as number) - preferredIndex);
            const nearestDistance = Math.abs((frameIndexes.get(nearest) as number) - preferredIndex);
            return candidateDistance < nearestDistance ? candidate : nearest;
        });
    };

    const trackFrame = (track: RectangleTrackMetadata): number | null => {
        const candidates = visibleTrackFrames(track);
        return candidates.includes(frame) ? frame : nearestFrame(candidates, frame);
    };

    const navigateTrack = (track: RectangleTrackMetadata, targetFrame?: number): void => {
        const destination = typeof targetFrame === 'undefined' ?
            trackFrame(track) : nearestFrame(visibleTrackFrames(track), targetFrame);
        if (destination !== null) {
            dispatch(navigateToRectangleTrackAsync(destination, track.clientID));
        }
    };

    const navigateAdjacentTrack = (direction: 'forward' | 'backward'): void => {
        const activatableTracks = filteredTracks.filter((track) => visibleTrackFrames(track).length);
        const currentIndex = activatableTracks.findIndex((track) => track.clientID === activeID);
        let targetIndex = currentIndex + 1;
        if (direction === 'backward') {
            targetIndex = currentIndex === -1 ? activatableTracks.length - 1 : currentIndex - 1;
        }
        const target = activatableTracks[targetIndex];
        if (target) navigateTrack(target);
    };

    const handlers = {
        PREVIOUS_ANNOTATION_FRAME: (event?: KeyboardEvent) => {
            event?.preventDefault();
            navigateAnnotation('backward');
        },
        NEXT_ANNOTATION_FRAME: (event?: KeyboardEvent) => {
            event?.preventDefault();
            navigateAnnotation('forward');
        },
        PREVIOUS_RECTANGLE_TRACK: (event?: KeyboardEvent) => {
            event?.preventDefault();
            navigateAdjacentTrack('backward');
        },
        NEXT_RECTANGLE_TRACK: (event?: KeyboardEvent) => {
            event?.preventDefault();
            navigateAdjacentTrack('forward');
        },
    };

    return (
        <div className={`cvat-rectangle-track-timeline ${expanded ? 'cvat-rectangle-track-timeline-expanded' : ''}`}>
            <GlobalHotKeys keyMap={subKeyMap(componentShortcuts, keyMap)} handlers={handlers} />
            <div className='cvat-rectangle-track-timeline-header'>
                <Button
                    type='text'
                    size='small'
                    icon={expanded ? <CaretDownOutlined /> : <CaretUpOutlined />}
                    onClick={() => setExpanded(!expanded)}
                >
                    Track timeline
                </Button>
                <Select
                    size='small'
                    value={labelID === null ? 'any' : `${labelID}`}
                    options={labelOptions}
                    onChange={(value) => setLabelID(value === 'any' ? null : +value)}
                />
                <Button.Group>
                    <Button size='small' title='Previous annotation frame ([)' onClick={() => navigateAnnotation('backward')}>
                        <LeftOutlined />
                    </Button>
                    <Button size='small' title='Next annotation frame (])' onClick={() => navigateAnnotation('forward')}>
                        <RightOutlined />
                    </Button>
                </Button.Group>
                <span>{filteredTracks.length} tracks</span>
            </div>
            {expanded && (
                <div className='cvat-rectangle-track-timeline-body'>
                    {filteredTracks.length ? filteredTracks.map((track) => (
                        <div
                            className={`cvat-rectangle-track-timeline-row ${
                                track.clientID === activeID ? 'cvat-rectangle-track-timeline-row-active' : ''
                            }`}
                            key={track.clientID}
                        >
                            <button type='button' className='cvat-rectangle-track-timeline-label' onClick={() => navigateTrack(track)}>
                                <span>{track.labelName}</span>
                                <small>#{track.clientID}</small>
                            </button>
                            <div className='cvat-rectangle-track-timeline-track'>
                                {track.visibleSegments.map((segment) => {
                                    const startIndex = frameIndexes.get(segment.start) ?? 0;
                                    const stopIndex = frameIndexes.get(segment.stop) ?? startIndex;
                                    const left = (startIndex / Math.max(1, frameNumbers.length - 1)) * 100;
                                    const width = ((stopIndex - startIndex + 1) /
                                        Math.max(1, frameNumbers.length)) * 100;
                                    return (
                                        <button
                                            type='button'
                                            className='cvat-rectangle-track-timeline-segment'
                                            key={`${segment.start}-${segment.stop}`}
                                            style={{ left: `${left}%`, width: `${Math.max(0.3, width)}%` }}
                                            title={`Frames ${segment.start}–${segment.stop}`}
                                            onClick={(event) => {
                                                const bounds = event.currentTarget.getBoundingClientRect();
                                                const offset = (event.clientX - bounds.left) / bounds.width;
                                                const segmentLength = stopIndex - startIndex;
                                                const targetIndex = startIndex + Math.round(offset * segmentLength);
                                                const destination = nearestFrame(
                                                    segmentFrames(segment), frameNumbers[targetIndex],
                                                );
                                                if (destination !== null) navigateTrack(track, destination);
                                            }}
                                        />
                                    );
                                })}
                                <svg viewBox='0 0 1000 24' preserveAspectRatio='none' aria-hidden='true'>
                                    <path
                                        className='cvat-rectangle-track-timeline-keyframes'
                                        d={pathForKeyframes(
                                            track.keyframes.filter((keyframe) => (
                                                !keyframe.outside && !keyframe.deleted
                                            )),
                                            frameIndexes,
                                            frameNumbers.length,
                                        )}
                                    />
                                    <path
                                        className='cvat-rectangle-track-timeline-keyframes-special'
                                        d={pathForKeyframes(
                                            track.keyframes.filter((keyframe) => keyframe.outside || keyframe.deleted),
                                            frameIndexes,
                                            frameNumbers.length,
                                        )}
                                    />
                                </svg>
                                <span className='cvat-rectangle-track-timeline-playhead' style={{ left: `${currentPosition}%` }} />
                            </div>
                        </div>
                    )) : (
                        <div className='cvat-rectangle-track-timeline-empty'>No rectangle tracks in this label scope.</div>
                    )}
                </div>
            )}
        </div>
    );
}
