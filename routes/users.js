var User = require('../models/user');
var Task = require('../models/task');

module.exports = function (router) {

    // Users collection routes
    var usersRoute = router.route('/users');

    // GET /api/users - Get all users with query parameters
    usersRoute.get(function (req, res) {
        try {
            var query = {};
            var sort = {};
            var select = {};
            var skip = 0;
            var limit = 0;
            var count = false;

            if (req.query.where) {
                try {
                    query = JSON.parse(req.query.where);
                } catch (e) {
                    return res.status(400).json({
                        message: "Invalid JSON in 'where' parameter",
                        data: {}
                    });
                }
            }

            if (req.query.sort) {
                try {
                    sort = JSON.parse(req.query.sort);
                } catch (e) {
                    return res.status(400).json({
                        message: "Invalid JSON in 'sort' parameter",
                        data: {}
                    });
                }
            }

            if (req.query.select) {
                try {
                    select = JSON.parse(req.query.select);
                } catch (e) {
                    return res.status(400).json({
                        message: "Invalid JSON in 'select' parameter",
                        data: {}
                    });
                }
            }

            if (req.query.skip) {
                skip = parseInt(req.query.skip);
            }

            if (req.query.limit) {
                limit = parseInt(req.query.limit);
            }

            if (req.query.count) {
                count = req.query.count === 'true';
            }

            if (count) {
                User.countDocuments(query, function (err, result) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error counting users",
                            data: {}
                        });
                    }
                    return res.status(200).json({
                        message: "OK",
                        data: result
                    });
                });
            } else {
                var dbQuery = User.find(query).sort(sort).select(select).skip(skip);
                
                if (limit > 0) {
                    dbQuery = dbQuery.limit(limit);
                }

                dbQuery.exec(function (err, users) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error retrieving users",
                            data: {}
                        });
                    }
                    return res.status(200).json({
                        message: "OK",
                        data: users
                    });
                });
            }
        } catch (error) {
            return res.status(500).json({
                message: "Server error",
                data: {}
            });
        }
    });

    // POST /api/users - Create a new user
    usersRoute.post(function (req, res) {
        if (!req.body.name || !req.body.email) {
            return res.status(400).json({
                message: "Name and email are required",
                data: {}
            });
        }

        var user = new User();
        user.name = req.body.name;
        user.email = req.body.email;
        user.pendingTasks = req.body.pendingTasks || [];

        user.save(function (err, savedUser) {
            if (err) {
                if (err.code === 11000) {
                    return res.status(400).json({
                        message: "User with this email already exists",
                        data: {}
                    });
                }
                return res.status(500).json({
                    message: "Error creating user",
                    data: {}
                });
            }
            return res.status(201).json({
                message: "User created",
                data: savedUser
            });
        });
    });

    // Single user routes
    var userRoute = router.route('/users/:id');

    // GET /api/users/:id - Get a specific user
    userRoute.get(function (req, res) {
        var select = {};

        if (req.query.select) {
            try {
                select = JSON.parse(req.query.select);
            } catch (e) {
                return res.status(400).json({
                    message: "Invalid JSON in 'select' parameter",
                    data: {}
                });
            }
        }

        User.findById(req.params.id).select(select).exec(function (err, user) {
            if (err) {
                return res.status(500).json({
                    message: "Error retrieving user",
                    data: {}
                });
            }
            if (!user) {
                return res.status(404).json({
                    message: "User not found",
                    data: {}
                });
            }
            return res.status(200).json({
                message: "OK",
                data: user
            });
        });
    });

    // PUT /api/users/:id - Replace a user
    userRoute.put(function (req, res) {
        if (!req.body.name || !req.body.email) {
            return res.status(400).json({
                message: "Name and email are required",
                data: {}
            });
        }

        User.findById(req.params.id, function (err, user) {
            if (err) {
                return res.status(500).json({
                    message: "Error retrieving user",
                    data: {}
                });
            }
            if (!user) {
                return res.status(404).json({
                    message: "User not found",
                    data: {}
                });
            }

            var oldPendingTasks = user.pendingTasks || [];
            
            var newPendingTasks = req.body.pendingTasks || [];
            if (!Array.isArray(newPendingTasks)) {
                if (typeof newPendingTasks === 'string') {
                    newPendingTasks = [newPendingTasks];
                } else {
                    newPendingTasks = [];
                }
            }

            // Calculate tasks to remove and add
            var tasksToRemove = oldPendingTasks.filter(function (taskId) {
                return newPendingTasks.indexOf(taskId) === -1;
            });

            var tasksToAdd = newPendingTasks.filter(function (taskId) {
                return oldPendingTasks.indexOf(taskId) === -1;
            });

            // Check for conflicts before saving
            if (tasksToAdd.length > 0) {
                Task.find({ _id: { $in: tasksToAdd } }, function (err, tasks) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error checking tasks",
                            data: {}
                        });
                    }

                    // Check if any task is already assigned to another user or is completed
                    for (var i = 0; i < tasks.length; i++) {
                        var task = tasks[i];
     
                        if (task.assignedUser && 
                            task.assignedUser !== "" && 
                            task.assignedUser !== req.params.id) {
                            return res.status(400).json({
                                message: "Task is already assigned to another user",
                                data: {}
                            });
                        }

                        if (task.completed) {
                            return res.status(400).json({
                                message: "Completed tasks cannot be in pending tasks",
                                data: {}
                            });
                        }
                    }

                    // No conflicts, proceed to update user
                    user.name = req.body.name;
                    user.email = req.body.email;
                    user.pendingTasks = newPendingTasks;

                    user.save(function (err, updatedUser) {
                        if (err) {
                            if (err.code === 11000) {
                                return res.status(400).json({
                                    message: "User with this email already exists",
                                    data: {}
                                });
                            }
                            return res.status(500).json({
                                message: "Error updating user",
                                data: {}
                            });
                        }

                        // Unassign removed tasks
                        if (tasksToRemove.length > 0) {
                            Task.updateMany(
                                { _id: { $in: tasksToRemove } },
                                { assignedUser: "", assignedUserName: "unassigned" },
                                function (err) {
                                    if (err) {
                                        console.error("Error unassigning tasks:", err);
                                    }
                                }
                            );
                        }

                        // Assign new tasks
                        Task.updateMany(
                            { _id: { $in: tasksToAdd } },
                            { assignedUser: updatedUser._id.toString(), assignedUserName: updatedUser.name },
                            function (err) {
                                if (err) {
                                    console.error("Error assigning tasks:", err);
                                }
                            }
                        );

                        return res.status(200).json({
                            message: "User updated",
                            data: updatedUser
                        });
                    });
                });
            } else {
                // No new tasks to add, just handle updates
                user.name = req.body.name;
                user.email = req.body.email;
                user.pendingTasks = newPendingTasks;

                user.save(function (err, updatedUser) {
                    if (err) {
                        if (err.code === 11000) {
                            return res.status(400).json({
                                message: "User with this email already exists",
                                data: {}
                            });
                        }
                        return res.status(500).json({
                            message: "Error updating user",
                            data: {}
                        });
                    }

                    if (tasksToRemove.length > 0) {
                        Task.updateMany(
                            { _id: { $in: tasksToRemove } },
                            { assignedUser: "", assignedUserName: "unassigned" },
                            function (err) {
                                if (err) {
                                    console.error("Error unassigning tasks:", err);
                                }
                            }
                        );
                    }

                    return res.status(200).json({
                        message: "User updated",
                        data: updatedUser
                    });
                });
            }
        });
    });

    // DELETE /api/users/:id - Delete a user
    userRoute.delete(function (req, res) {
        User.findById(req.params.id, function (err, user) {
            if (err) {
                return res.status(500).json({
                    message: "Error retrieving user",
                    data: {}
                });
            }
            if (!user) {
                return res.status(404).json({
                    message: "User not found",
                    data: {}
                });
            }

            var pendingTasks = user.pendingTasks || [];

            user.remove(function (err) {
                if (err) {
                    return res.status(500).json({
                        message: "Error deleting user",
                        data: {}
                    });
                }

                // Unassign all tasks that were assigned to this user
                if (pendingTasks.length > 0) {
                    Task.updateMany(
                        { _id: { $in: pendingTasks } },
                        { assignedUser: "", assignedUserName: "unassigned" },
                        function (err) {
                            if (err) {
                                console.error("Error unassigning tasks:", err);
                            }
                        }
                    );
                }

                return res.status(200).json({
                    message: "User deleted",
                    data: user
                });
            });
        });
    });

    return router;
};
